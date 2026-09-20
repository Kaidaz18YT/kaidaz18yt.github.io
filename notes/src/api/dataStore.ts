import { config } from '../config';
import { newNote, newProject, newTask } from '../models/factories';
import type {
  Entry, Fields, Item, Note, Project, RawRecord, Task,
} from '../models/types';
import { addDays, localDate, nowIso, toMs } from '../utils/dates';
import { pocketBaseNotesBackend, type RecordBackend } from './notes';
import { isType, resolveRecords } from './resolve';

export type SyncStatus = 'loading' | 'connected' | 'syncing' | 'offline' | 'unreachable';

export interface Snapshot {
  status: SyncStatus;
  loaded: boolean;
  lastSyncedAt: number | null;
  error: string | null;
  /** Saves currently waiting on the server. */
  pending: number;
  /** Records in the collection that aren't app items (plain notes etc). */
  unrecognised: number;
  recordCount: number;
  /** Current state of every live (non-deleted) item. */
  tasks: Entry<Task>[];
  projects: Entry<Project>[];
  notes: Entry<Note>[];
  /** Every item including deleted ones, for history views. */
  all: Entry[];
}

export class SaveError extends Error {
  constructor(public reason: 'too_long' | 'network' | 'missing', message: string) {
    super(message);
  }
}

interface Cache { records: RawRecord[]; syncedAt: number }

export class DataStore {
  private records = new Map<string, RawRecord>();
  private pendingIds = new Set<string>();
  private listeners = new Set<() => void>();
  private tempCounter = 0;
  private refreshCount = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private unsubscribeRealtime: (() => void) | undefined;
  private started = false;
  private snapshot: Snapshot;

  constructor(private backend: RecordBackend) {
    this.snapshot = this.buildSnapshot('loading', null, null, false);
  }

  // --- React binding (useSyncExternalStore) --------------------------------
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => { this.listeners.delete(l); };
  };
  getSnapshot = () => this.snapshot;

  // --- Lifecycle ------------------------------------------------------------
  async start() {
    if (this.started) return;
    this.started = true;
    const cached = this.loadCache();
    if (cached) {
      cached.records.forEach((r) => this.records.set(r.id, r));
      this.publish({ status: 'syncing', loaded: true, lastSyncedAt: cached.syncedAt });
    }
    await this.refresh({ full: true });
    // Realtime is a bonus; polling below is the guaranteed path.
    this.backend.subscribe(this.onRealtime).then(
      (unsub) => { this.unsubscribeRealtime = unsub; },
      () => { /* realtime unavailable: polling still works */ },
    );
    this.timer = setInterval(() => {
      this.refreshCount++;
      void this.refresh({ full: this.refreshCount % config.fullResyncEvery === 0 });
    }, config.refreshIntervalMs);
    window.addEventListener('online', this.onOnline);
  }

  stop() {
    clearInterval(this.timer);
    this.unsubscribeRealtime?.();
    window.removeEventListener('online', this.onOnline);
    this.started = false;
  }

  private onOnline = () => { void this.refresh(); };

  private onRealtime = (action: 'create' | 'update' | 'delete', rec: RawRecord) => {
    if (action === 'delete') this.records.delete(rec.id);
    else this.records.set(rec.id, rec);
    this.saveCache();
    this.publish({});
  };

  // --- Reading from the server ---------------------------------------------
  async refresh(opts: { full?: boolean } = {}) {
    this.publish({ status: this.snapshot.loaded ? 'syncing' : 'loading' });
    try {
      const since = opts.full ? undefined : this.latestCreated();
      const fetched = await this.backend.list(since);
      if (opts.full || !since) {
        // A full download replaces everything except saves still in flight.
        for (const id of [...this.records.keys()]) {
          if (!this.pendingIds.has(id)) this.records.delete(id);
        }
      }
      fetched.forEach((r) => this.records.set(r.id, r));
      this.saveCache();
      this.publish({ status: 'connected', loaded: true, lastSyncedAt: Date.now(), error: null });
    } catch (e) {
      this.publish({
        status: navigator.onLine === false ? 'offline' : 'unreachable',
        loaded: this.snapshot.loaded,
        error: e instanceof Error ? e.message : 'Unknown error',
      });
    }
  }

  private latestCreated(): string | undefined {
    let best = 0;
    let bestStr: string | undefined;
    for (const r of this.records.values()) {
      if (this.pendingIds.has(r.id)) continue;
      const ms = toMs(r.created);
      if (ms > best) { best = ms; bestStr = r.created; }
    }
    return bestStr;
  }

  // --- Writing (versioned-create) ------------------------------------------
  /**
   * The single place a write reaches the server. If update/delete access is
   * ever enabled, this is the method to change.
   */
  private async commit(item: Item): Promise<void> {
    const text = JSON.stringify(item);
    if (text.length > config.maxTextLength) {
      throw new SaveError(
        'too_long',
        `This is too long to save (${text.length} of ${config.maxTextLength} characters). ` +
          'Shorten it, or raise the text field limit in PocketBase.',
      );
    }
    // Optimistic: show it immediately, marked pending until the server confirms.
    const tempId = `local-${++this.tempCounter}`;
    const now = nowIso();
    this.records.set(tempId, { id: tempId, created: now, updated: now, text });
    this.pendingIds.add(tempId);
    this.publish({});
    try {
      const saved = await this.backend.create(text);
      this.records.delete(tempId);
      this.pendingIds.delete(tempId);
      this.records.set(saved.id, saved);
      this.saveCache();
      this.publish({ status: 'connected', error: null });
    } catch {
      // Roll back so the UI never claims something was saved when it wasn't.
      this.records.delete(tempId);
      this.pendingIds.delete(tempId);
      this.publish({ status: navigator.onLine === false ? 'offline' : 'unreachable' });
      throw new SaveError(
        'network',
        'Unable to save this. Your connection to the server may have been interrupted.',
      );
    }
  }

  async createItem<T extends Item>(item: T): Promise<T> {
    await this.commit(item);
    return item;
  }

  /** Save a new version of an existing item. */
  async updateItem<T extends Item>(itemId: string, patch: Partial<Fields<T>>): Promise<T> {
    const current = this.snapshot.all.find((e) => e.item.itemId === itemId);
    if (!current) throw new SaveError('missing', 'That item no longer exists.');
    const next = {
      ...current.item,
      ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)),
      itemId: current.item.itemId,
      type: current.item.type,
      version: current.item.version + 1,
      supersedes: current.recordId,
      updatedAt: nowIso(),
    } as Item;
    await this.commit(next);
    return next as T;
  }

  /** "Delete" = write a tombstone version. Hard deletion stays a superuser job. */
  async deleteItem(itemId: string): Promise<void> {
    await this.updateItem(itemId, { deleted: true } as never);
  }

  // --- Snapshot -------------------------------------------------------------
  private publish(patch: Partial<Pick<Snapshot, 'status' | 'loaded' | 'lastSyncedAt' | 'error'>>) {
    const s = this.snapshot;
    this.snapshot = this.buildSnapshot(
      patch.status ?? s.status,
      patch.lastSyncedAt ?? s.lastSyncedAt,
      patch.error === undefined ? s.error : patch.error,
      patch.loaded ?? s.loaded,
    );
    this.listeners.forEach((l) => l());
  }

  private buildSnapshot(
    status: SyncStatus, lastSyncedAt: number | null, error: string | null, loaded: boolean,
  ): Snapshot {
    const { entries, unrecognised } = resolveRecords(this.records.values());
    const live = entries.filter((e) => !e.item.deleted);
    return {
      status, loaded, lastSyncedAt, error,
      pending: this.pendingIds.size,
      unrecognised,
      recordCount: this.records.size,
      tasks: live.filter(isType('task')),
      projects: live.filter(isType('project')),
      notes: live.filter(isType('note')),
      all: entries,
    };
  }

  // --- Offline cache --------------------------------------------------------
  private loadCache(): Cache | null {
    try {
      const raw = localStorage.getItem(config.cacheKey);
      return raw ? (JSON.parse(raw) as Cache) : null;
    } catch { return null; }
  }
  private saveCache() {
    try {
      const records = [...this.records.values()].filter((r) => !this.pendingIds.has(r.id));
      localStorage.setItem(config.cacheKey, JSON.stringify({ records, syncedAt: Date.now() }));
    } catch { /* storage full or blocked: the cache is optional */ }
  }
}

// ---------------------------------------------------------------------------
// The app-facing API. UI code calls these, never PocketBase directly.
// ---------------------------------------------------------------------------
export const store = new DataStore(pocketBaseNotesBackend);

export const getItems = () => store.getSnapshot().all.filter((e) => !e.item.deleted);
export const getTasks = () => store.getSnapshot().tasks;
export const getProjects = () => store.getSnapshot().projects;
export const getNotes = () => store.getSnapshot().notes;
export const getProjectTasks = (projectId: string) =>
  getTasks().filter((t) => t.item.projectId === projectId);

export const getUpcomingTasks = (days = 7) => {
  const today = localDate();
  const end = addDays(today, days);
  return getTasks()
    .filter((t) => !t.item.completed && t.item.dueDate && t.item.dueDate >= today && t.item.dueDate <= end)
    .sort((a, b) => (a.item.dueDate! + (a.item.dueTime ?? '')).localeCompare(b.item.dueDate! + (b.item.dueTime ?? '')));
};

export function searchItems(query: string): Entry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return getItems().filter(({ item }) => {
    const hay = [
      'title' in item ? item.title : item.name,
      'description' in item ? item.description : '',
      'content' in item ? item.content : '',
      'notes' in item ? item.notes : '',
      ...item.tags,
    ].join(' ').toLowerCase();
    return hay.includes(q);
  });
}

export const createItem = <T extends Item>(item: T) => store.createItem(item);
export const createTask = (input: Partial<Fields<Task>>) => store.createItem(newTask(input));
export const createProject = (input: Partial<Fields<Project>>) => store.createItem(newProject(input));
export const createNote = (input: Partial<Fields<Note>>) => store.createItem(newNote(input));
export const updateItem = <T extends Item>(itemId: string, patch: Partial<Fields<T>>) =>
  store.updateItem<T>(itemId, patch);
export const deleteItem = (itemId: string) => store.deleteItem(itemId);

/** Project progress is derived from its tasks, never stored. */
export const projectProgress = (projectId: string) => {
  const tasks = getProjectTasks(projectId).filter((t) => !t.item.archived);
  const done = tasks.filter((t) => t.item.completed).length;
  return { total: tasks.length, done, percent: tasks.length ? Math.round((done / tasks.length) * 100) : 0 };
};
