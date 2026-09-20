import { useState } from 'react';
import {
  createProject, createTask, deleteItem, projectProgress, store, updateItem,
} from '../api/dataStore';
import { useStore } from '../hooks/useStore';
import type { Task } from '../models/types';
import { config } from '../config';

/**
 * Temporary foundation check: proves reads, creates, versioned edits and
 * tombstone deletes all work against your PocketBase. Test items are prefixed
 * "[TEST]" so they are easy to find and remove in the PocketBase admin UI.
 */
export default function Check() {
  const s = useStore();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const testProject = s.projects.find((p) => p.item.name.startsWith('[TEST]'));
  const testTask = s.tasks.find((t) => t.item.title.startsWith('[TEST]'));

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      setMessage(`${label}: done.`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <h1>Foundation check</h1>
      <p className="muted">
        Server: {config.pocketbaseUrl} · collection “{config.collection}”
      </p>

      {s.status === 'unreachable' && (
        <div className="banner" role="alert">
          Unable to reach the server. Your last saved data is shown below.
          {s.error && <div className="muted small">{s.error}</div>}
        </div>
      )}
      {message && <div className="banner" role="status">{message}</div>}

      <section className="card">
        <h2>What was read</h2>
        <ul>
          <li>{s.recordCount} records in the collection</li>
          <li>{s.projects.length} projects, {s.tasks.length} tasks, {s.notes.length} notes</li>
          <li>{s.unrecognised} records that aren’t app items (ignored)</li>
        </ul>
      </section>

      <section className="card">
        <h2>Try it</h2>
        <div className="row">
          <button disabled={busy} onClick={() => run('Project created', () =>
            createProject({ name: '[TEST] Sample project', description: 'Created by the foundation check.' }))}>
            1. Add test project
          </button>
          <button disabled={busy} onClick={() => run('Task created', () =>
            createTask({
              title: '[TEST] Sample task',
              projectId: testProject?.item.itemId ?? null,
              priority: 'high',
            }))}>
            2. Add test task
          </button>
          <button disabled={busy || !testTask} onClick={() => run('New version saved', () =>
            updateItem<Task>(testTask!.item.itemId, {
              status: 'done', completed: true, completedAt: new Date().toISOString(),
            }))}>
            3. Mark test task done (new version)
          </button>
          <button disabled={busy || !testTask} onClick={() => run('Task hidden', () =>
            deleteItem(testTask!.item.itemId))}>
            4. Delete test task (tombstone)
          </button>
          <button disabled={busy} onClick={() => run('Refreshed', () => store.refresh({ full: true }))}>
            Refresh
          </button>
        </div>
      </section>

      {testTask && (
        <section className="card">
          <h2>Test task history</h2>
          <p className="muted small">Current state comes from the newest version; older ones stay as history.</p>
          <ol>
            {testTask.history.map((h) => (
              <li key={h.recordId}>
                v{h.item.version} · {h.item.status}
                {h.item.completed ? ' (completed)' : ''} · record {h.recordId}
              </li>
            ))}
          </ol>
        </section>
      )}

      {testProject && (
        <section className="card">
          <h2>Test project progress</h2>
          {(() => { const p = projectProgress(testProject.item.itemId);
            return <p>{p.done} of {p.total} tasks done ({p.percent}%)</p>; })()}
        </section>
      )}
    </div>
  );
}
