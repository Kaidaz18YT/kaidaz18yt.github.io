import type { Fields, Note, Project, Task } from './types';
import { SCHEMA_VERSION } from './types';
import { nowIso } from '../utils/dates';

export const makeId = (prefix: string) =>
  `${prefix}-${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;

const defined = <T extends object>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

function base<K extends 'task' | 'project' | 'note'>(type: K) {
  const now = nowIso();
  return {
    type, schemaVersion: SCHEMA_VERSION, itemId: makeId(type), version: 1,
    deleted: false, createdAt: now, updatedAt: now,
  };
}

export function newTask(input: Partial<Fields<Task>> = {}): Task {
  return {
    ...base('task'),
    title: 'Untitled task', description: '', projectId: null, status: 'todo',
    priority: 'normal', dueDate: null, dueTime: null, tags: [], notes: '',
    subtasks: [], completed: false, completedAt: null, recurrence: null, archived: false,
    ...defined(input),
  };
}

export function newProject(input: Partial<Fields<Project>> = {}): Project {
  return {
    ...base('project'),
    name: 'Untitled project', description: '', status: 'active', priority: 'normal',
    color: '#4f8cff', icon: '📁', tags: [], startDate: null, dueDate: null,
    notes: '', milestones: [],
    ...defined(input),
  };
}

export function newNote(input: Partial<Fields<Note>> = {}): Note {
  return {
    ...base('note'),
    title: 'Untitled note', content: '', tags: [], projectId: null,
    pinned: false, color: 'default',
    ...defined(input),
  };
}
