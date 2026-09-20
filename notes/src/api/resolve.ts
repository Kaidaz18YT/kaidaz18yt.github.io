import { parseRecord } from '../models/parse';
import type { Entry, HistoryEntry, Item, RawRecord } from '../models/types';
import { toMs } from '../utils/dates';

/** Newest first: highest version, then latest PocketBase created time, then id. */
const newestFirst = (a: HistoryEntry, b: HistoryEntry) =>
  b.item.version - a.item.version ||
  toMs(b.recordCreated) - toMs(a.recordCreated) ||
  (a.recordId < b.recordId ? 1 : -1);

/**
 * The heart of the versioned-create model: fold every stored record into one
 * Entry per itemId. The newest version is the current state; the rest is history.
 * Two devices editing at once can both produce "version 3"; the later
 * PocketBase created time wins, and the loser stays in history.
 */
export function resolveRecords(records: Iterable<RawRecord>): { entries: Entry[]; unrecognised: number } {
  const groups = new Map<string, HistoryEntry[]>();
  let unrecognised = 0;

  for (const rec of records) {
    const parsed = parseRecord(rec);
    if (!parsed) { unrecognised++; continue; }
    const list = groups.get(parsed.item.itemId) ?? [];
    list.push({ recordId: parsed.recordId, recordCreated: parsed.recordCreated, item: parsed.item });
    groups.set(parsed.item.itemId, list);
  }

  const entries: Entry[] = [];
  for (const history of groups.values()) {
    history.sort(newestFirst);
    const [current] = history;
    // Group members always share the current item's type. A stray record that
    // reuses an itemId with a different type is dropped from the group.
    const sameType = history.filter((h) => h.item.type === current.item.type);
    entries.push({
      item: current.item,
      recordId: current.recordId,
      recordCreated: current.recordCreated,
      history: sameType,
    });
  }
  return { entries, unrecognised };
}

export const isType = <T extends Item['type']>(type: T) =>
  (e: Entry): e is Entry<Extract<Item, { type: T }>> => e.item.type === type;
