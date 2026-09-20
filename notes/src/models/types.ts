export const SCHEMA_VERSION = 1;

export type ItemType = 'project' | 'task' | 'note';
export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'blocked' | 'done';
export type Priority = 'low' | 'normal' | 'high' | 'urgent';
export type ProjectStatus = 'planning' | 'active' | 'paused' | 'completed' | 'archived';

export const TASK_STATUSES: readonly TaskStatus[] = ['backlog', 'todo', 'in_progress', 'blocked', 'done'];
export const PRIORITIES: readonly Priority[] = ['low', 'normal', 'high', 'urgent'];
export const PROJECT_STATUSES: readonly ProjectStatus[] = ['planning', 'active', 'paused', 'completed', 'archived'];

/** Fields present on every stored item (this is the JSON that lives in notes.text). */
export interface Base {
  type: ItemType;
  schemaVersion: number;
  /** Stable identity of the thing across all its versions. */
  itemId: string;
  /** 1, 2, 3... Highest version is the current state. */
  version: number;
  /** PocketBase record id of the version this one replaces. */
  supersedes?: string;
  /** Tombstone. A deleted item is hidden but its history stays. */
  deleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Subtask { id: string; title: string; done: boolean }
export interface Milestone { id: string; title: string; date: string | null; done: boolean }
export interface Recurrence { every: number; unit: 'day' | 'week' | 'month' }

export interface Task extends Base {
  type: 'task';
  title: string;
  description: string;
  projectId: string | null;
  status: TaskStatus;
  priority: Priority;
  dueDate: string | null; // YYYY-MM-DD
  dueTime: string | null; // HH:MM
  tags: string[];
  notes: string;
  subtasks: Subtask[];
  completed: boolean;
  completedAt: string | null;
  recurrence: Recurrence | null;
  archived: boolean;
}

export interface Project extends Base {
  type: 'project';
  name: string;
  description: string;
  status: ProjectStatus;
  priority: Priority;
  color: string;
  icon: string;
  tags: string[];
  startDate: string | null;
  dueDate: string | null;
  notes: string;
  milestones: Milestone[];
}

export interface Note extends Base {
  type: 'note';
  title: string;
  content: string;
  tags: string[];
  projectId: string | null;
  pinned: boolean;
  color: string;
}

export type Item = Task | Project | Note;
export type Fields<T extends Item> = Omit<T, keyof Base>;

/** A PocketBase record exactly as the server sends it. */
export interface RawRecord {
  id: string;
  created: string;
  updated: string;
  text: string;
}

export interface HistoryEntry<T extends Item = Item> {
  recordId: string;
  /** PocketBase's own created timestamp for the record. */
  recordCreated: string;
  item: T;
}

/** The current state of one item plus every older version. */
export interface Entry<T extends Item = Item> {
  item: T;
  recordId: string;
  recordCreated: string;
  history: HistoryEntry<T>[]; // newest first, includes the current version
}
