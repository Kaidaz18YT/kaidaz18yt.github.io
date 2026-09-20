import { store, type SyncStatus } from '../api/dataStore';
import { useStore } from '../hooks/useStore';

const LABEL: Record<SyncStatus, string> = {
  loading: 'Loading…',
  syncing: 'Syncing…',
  connected: 'Connected',
  offline: 'Offline',
  unreachable: 'Unable to reach server',
};
// A symbol as well as a colour, so status never relies on colour alone.
const ICON: Record<SyncStatus, string> = {
  loading: '◌', syncing: '↻', connected: '●', offline: '○', unreachable: '▲',
};

export default function SyncPill() {
  const s = useStore();
  const bad = s.status === 'offline' || s.status === 'unreachable';
  return (
    <div className={`pill pill-${s.status}`} role="status" aria-live="polite">
      <span aria-hidden="true">{ICON[s.status]}</span>
      <span>{LABEL[s.status]}{s.pending > 0 ? ` (${s.pending} saving)` : ''}</span>
      {bad && (
        <button className="link" onClick={() => void store.refresh({ full: true })}>Retry</button>
      )}
    </div>
  );
}
