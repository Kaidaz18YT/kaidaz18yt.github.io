// Single place for every backend/tuning value. Nothing secret belongs here:
// this file ships to the browser.
export const config = {
  pocketbaseUrl:
    (import.meta.env.VITE_POCKETBASE_URL as string | undefined) ??
    'https://kaidaz18.duckdns.org',
  collection: 'notes',
  /** PocketBase text fields default to a 5000 character limit unless raised. */
  maxTextLength: 5000,
  refreshIntervalMs: 60_000,
  /** Every Nth background refresh re-downloads everything (catches admin deletions). */
  fullResyncEvery: 10,
  cacheKey: 'cc.cache.v1',
} as const;
