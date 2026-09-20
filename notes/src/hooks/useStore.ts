import { useEffect, useSyncExternalStore } from 'react';
import { store } from '../api/dataStore';

/** Subscribe a component to the data store and make sure syncing has started. */
export function useStore() {
  useEffect(() => { void store.start(); }, []);
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
