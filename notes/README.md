# Command Centre

Static React + TypeScript + Vite app that stores projects, tasks and notes in
a PocketBase `notes` collection. Hosted on GitHub Pages; no backend of its own.

## Status

Foundation only: data layer, parser, versioned-create, sync status, GitHub Pages
workflow, and a check page that exercises them. Projects/tasks/notes UI, dashboard,
search, calendar and View Mode come next.

## Layout

```
src/config.ts          PocketBase URL + tuning (only place the URL lives)
src/api/pocketbase.ts  SDK instance
src/api/notes.ts       RecordBackend interface + PocketBase implementation
src/api/resolve.ts     records -> current item + history
src/api/dataStore.ts   store, cache, polling, realtime, app-facing functions
src/models/            types, tolerant parser, factories
```

## Data format (inside `notes.text`)

Each record's `text` is JSON. Shared fields on every item:

```json
{
  "type": "task",          // "task" | "project" | "note"
  "schemaVersion": 1,
  "itemId": "task-3f9a1c2b7d",
  "version": 4,
  "supersedes": "<PocketBase record id of version 3>",
  "deleted": false,
  "createdAt": "2026-09-20T12:00:00Z",
  "updatedAt": "2026-09-20T12:00:00Z"
}
```

plus the type's own fields (see `src/models/types.ts`). PocketBase's own
`id`/`created`/`updated` stay separate from this JSON. Records that aren't valid
items (plain-text notes, corrupt JSON) are ignored and counted.

## How editing works with locked update/delete

Every save creates a new record with `version + 1`. For each `itemId`, the
highest version is the current state and older records are its history. If two
devices save the same version, the later PocketBase `created` time wins and the
other stays in history. Deleting writes a version with `deleted: true`.
All writes go through `DataStore.commit()`; if update access is ever enabled,
that one method is where in-place updates would be added.

## Deployment

`.github/workflows/deploy.yml` builds and publishes on every push to `main`.
`vite.config.ts` uses relative asset paths (`base: './'`) and hash routing, so it
works at `https://user.github.io/repo/`. Override with `VITE_BASE`.
Set the PocketBase URL with `VITE_POCKETBASE_URL` if it ever moves.

Local: `npm install`, `npm run dev`, `npm run build`.
