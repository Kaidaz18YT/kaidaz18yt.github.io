import { config } from '../config';
import type { RawRecord } from '../models/types';
import { pb } from './pocketbase';

/**
 * The only thing the data store knows about the server. To move to real
 * projects/tasks collections or to authenticated update/delete later, write
 * another backend that satisfies this interface.
 */
export interface RecordBackend {
  /** All records, or only those created at/after `sinceCreated`. */
  list(sinceCreated?: string): Promise<RawRecord[]>;
  create(text: string): Promise<RawRecord>;
  /** Live changes. Returns an unsubscribe function. May reject if realtime is unavailable. */
  subscribe(onEvent: (action: 'create' | 'update' | 'delete', record: RawRecord) => void): Promise<() => void>;
}

// created/updated exist only if the collection has "autodate" fields (the
// PocketBase admin UI adds them by default). Fall back to "" if absent.
const toRaw = (r: Record<string, unknown> & { id: string }): RawRecord => ({
  id: r.id,
  created: typeof r.created === 'string' ? r.created : '',
  updated: typeof r.updated === 'string' ? r.updated : '',
  text: typeof r.text === 'string' ? r.text : '',
});

export const pocketBaseNotesBackend: RecordBackend = {
  async list(sinceCreated) {
    const col = pb.collection(config.collection);
    const records = await col.getFullList({
      batch: 200,
      sort: 'created',
      ...(sinceCreated ? { filter: pb.filter('created >= {:since}', { since: sinceCreated }) } : {}),
    });
    return records.map(toRaw);
  },

  async create(text) {
    const rec = await pb.collection(config.collection).create({ text });
    return toRaw(rec);
  },

  async subscribe(onEvent) {
    const col = pb.collection(config.collection);
    await col.subscribe('*', (e) => {
      if (e.action === 'create' || e.action === 'update' || e.action === 'delete') {
        onEvent(e.action, toRaw(e.record));
      }
    });
    return () => { void col.unsubscribe('*'); };
  },
};
