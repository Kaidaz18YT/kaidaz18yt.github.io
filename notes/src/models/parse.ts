import type {
  Item, ItemType, Milestone, Priority, ProjectStatus, RawRecord, Recurrence,
  Subtask, TaskStatus,
} from './types';
import { PRIORITIES, PROJECT_STATUSES, TASK_STATUSES } from './types';

// Every helper here returns a safe value for garbage input, so a malformed
// or hand-edited record can never crash the app.
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const bool = (v: unknown, d = false): boolean => (typeof v === 'boolean' ? v : d);
const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], d: T): T =>
  allowed.includes(v as T) ? (v as T) : d;
const posInt = (v: unknown, d: number): number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : d;

const subtasks = (v: unknown): Subtask[] =>
  Array.isArray(v)
    ? v.filter(isObj).map((s, i) => ({
        id: str(s.id, `st-${i}`), title: str(s.title), done: bool(s.done),
      }))
    : [];

const milestones = (v: unknown): Milestone[] =>
  Array.isArray(v)
    ? v.filter(isObj).map((m, i) => ({
        id: str(m.id, `ms-${i}`), title: str(m.title), date: strOrNull(m.date), done: bool(m.done),
      }))
    : [];

const recurrence = (v: unknown): Recurrence | null =>
  isObj(v) && ['day', 'week', 'month'].includes(v.unit as string)
    ? { every: posInt(v.every, 1), unit: v.unit as Recurrence['unit'] }
    : null;

const TYPES: readonly ItemType[] = ['project', 'task', 'note'];

export interface Parsed {
  item: Item;
  recordId: string;
  recordCreated: string;
}

/**
 * Turn a PocketBase record into a typed item, or null if it isn't ours
 * (plain-text notes, other apps' JSON, corrupt data). Nulls are counted and
 * ignored rather than thrown.
 */
export function parseRecord(rec: RawRecord): Parsed | null {
  let raw: unknown;
  try {
    raw = JSON.parse(rec.text);
  } catch {
    return null;
  }
  if (!isObj(raw)) return null;
  if (!TYPES.includes(raw.type as ItemType)) return null;
  const itemId = str(raw.itemId);
  if (!itemId) return null;

  // Future schema upgrades go here: switch on raw.schemaVersion and reshape
  // `raw` before the field-by-field read below. Only v1 exists today, and
  // unknown newer versions are read best-effort.
  const base = {
    schemaVersion: posInt(raw.schemaVersion, 1),
    itemId,
    version: posInt(raw.version, 1),
    supersedes: strOrNull(raw.supersedes) ?? undefined,
    deleted: bool(raw.deleted),
    createdAt: str(raw.createdAt, rec.created),
    updatedAt: str(raw.updatedAt, rec.updated),
  };

  let item: Item;
  switch (raw.type as ItemType) {
    case 'task': {
      const status = oneOf<TaskStatus>(raw.status, TASK_STATUSES, 'todo');
      item = {
        ...base, type: 'task',
        title: str(raw.title, 'Untitled task'),
        description: str(raw.description),
        projectId: strOrNull(raw.projectId),
        status,
        priority: oneOf<Priority>(raw.priority, PRIORITIES, 'normal'),
        dueDate: strOrNull(raw.dueDate),
        dueTime: strOrNull(raw.dueTime),
        tags: strArr(raw.tags),
        notes: str(raw.notes),
        subtasks: subtasks(raw.subtasks),
        completed: bool(raw.completed, status === 'done'),
        completedAt: strOrNull(raw.completedAt),
        recurrence: recurrence(raw.recurrence),
        archived: bool(raw.archived),
      };
      break;
    }
    case 'project':
      item = {
        ...base, type: 'project',
        name: str(raw.name, 'Untitled project'),
        description: str(raw.description),
        status: oneOf<ProjectStatus>(raw.status, PROJECT_STATUSES, 'active'),
        priority: oneOf<Priority>(raw.priority, PRIORITIES, 'normal'),
        color: str(raw.color, '#4f8cff'),
        icon: str(raw.icon, '📁'),
        tags: strArr(raw.tags),
        startDate: strOrNull(raw.startDate),
        dueDate: strOrNull(raw.dueDate),
        notes: str(raw.notes),
        milestones: milestones(raw.milestones),
      };
      break;
    default:
      item = {
        ...base, type: 'note',
        title: str(raw.title, 'Untitled note'),
        content: str(raw.content),
        tags: strArr(raw.tags),
        projectId: strOrNull(raw.projectId),
        pinned: bool(raw.pinned),
        color: str(raw.color, 'default'),
      };
  }
  return { item, recordId: rec.id, recordCreated: rec.created };
}
