# Ledger / BreadBackend

Ledger and its dashboard use the BreadBackend project `kaidaz18-notes` through
`bread-backend.js` and the hosted `bread-client.js` SDK. Only the **public client
key** belongs in this repository. Never put an administrator key in the site.

## Account and data requirements

- Sign in or create a BreadBackend account from `/notes/`. PocketBase accounts,
  documents, and attachments are **not** imported automatically. Export and
  migrate those separately if needed.
- `auth.me()` must return a user with a stable `id` (or `userId`/`_id`). Each
  Ledger document needs an `ownerId` matching that ID. Projects, tasks and notes
  are ordinary JSON documents; note attachments are stored as an array of file
  metadata, and task `linked_notes` is an array of note IDs.
- **Configure and test server-side per-user rules** for collection reads,
  writes, subscriptions, and file actions. `ownerId` filtering in the frontend
  only keeps the UI tidy; it is not security. The backend must derive ownership
  from the authenticated user and reject access to other users' data.
- The SDK must allow sessions to be restored after reload, either by returning a
  token from login or persisting its own session. Ledger calls the SDK's logout.
  If logout fails, the UI reports that server sign-out could not be confirmed.
- `collection.get()` must return the **complete** collection for the signed-in
  user (an array or an `items`, `documents`, or `data` array). If it returns a
  pagination indicator such as `hasMore` or `nextCursor`, Ledger refuses to
  treat that page as a complete workspace. A silently truncated plain array
  cannot be detected; pagination needs to be specified before relying on it.
- Live subscriptions are used when the SDK exposes `subscribe(callback)` and
  returns an unsubscribe function. A 30-second polling fallback and manual retry
  are also used. The backend must authenticate and scope realtime events.
- Allow the site origin through CORS, including `Authorization`, `x-api-key`,
  `Content-Type`, and the `GET`, `POST`, `PATCH`, `DELETE`, and `OPTIONS`
  methods. SDK and HTTPS certificate access are also required.

## Attachments

Files are uploaded separately using `bread.files.upload(file)` (maximum 50 MB
per file). Ledger accepts a `fullUrl` or a `filename`, and keeps the upload
result for retries if saving a note fails. A direct file URL may be public:
verify file access rules and use private or signed URLs before storing sensitive
attachments. The current client uses the returned URL directly in links and image
previews; it cannot attach a bearer header to those navigations or refresh
expired URLs. Private downloads need a backend-supported signed-URL/download API
and corresponding frontend changes.

Removing an attachment or deleting a note removes the reference, **not the
previously attached file from backend storage**. The API guide does not specify
complete pagination or reference-safe file deletion, so automatically deleting
such a file could damage another note. Clean up unneeded files in the backend
after checking references. Newly uploaded files which were never submitted may
be cleaned up when the SDK supports `files.delete`.

## Other differences

Stored rich-text HTML is sanitized with the vendored DOMPurify library before it
is inserted into the editor; its license is in `vendor/DOMPURIFY-LICENSE.txt`.


The old assistant depended on a PocketBase-specific AI endpoint. It is not
loaded because the new guide does not document an equivalent endpoint. A new
authenticated AI endpoint and frontend integration are needed to restore it.
`/notes/test/` can check the SDK, CORS/API reachability and browser storage,
but it does **not** verify privacy rules or real account access.

## Tests

The adapter tests use only Node.js:

```sh
node --test notes/tests/bread-backend.test.cjs
```

The browser integration test uses a **mock** BreadBackend, not the live server.
With `playwright-core` installed and `CHROMIUM_PATH` pointing at a Chromium
binary, run:

```sh
NODE_PATH=/path/to/node_modules CHROMIUM_PATH=/path/to/chromium \
  node notes/tests/browser.integration.cjs
```

Alternatively install `playwright-core` and `@sparticuz/chromium` in a temporary
test directory; the test uses the bundled Chromium when `CHROMIUM_PATH` is not
set. Chromium's system libraries must be installed on the test machine.
