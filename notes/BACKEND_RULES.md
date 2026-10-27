# Recommended BreadBackend rules for Ledger

Ledger is configured to sign in as `kaioliver111@gmail.com`; the page asks only
for the password. The email is included in the browser code and is **not a
secret**. Hiding the email or sign-up button does not protect the backend.

The BreadBackend guide does not specify the rule editor's syntax, so the policy
below is **pseudocode, not a copy-and-paste configuration**. Translate it into
whatever rule format the backend actually supports. These rules must be enforced
on the server, not just in the website.

## 1. Identify the owner

Find the stable user ID of the BreadBackend account for the email above in the
backend's user dashboard. Use that ID as `OWNER_ID` below. This is the same ID
that `auth.me()` returns and the same value Ledger uses for `ownerId`. Never use
a password, public API key, or admin key as `OWNER_ID`.

```text
OWNER_ID = <the stable user ID for the Ledger account>
IS_OWNER = request has a valid, unexpired user session
           AND session.userId == OWNER_ID
```

Require verification of the account if email verification is enabled. Disable
public/self-service signup for this project if the backend supports it; create
or manage the one account through the backend dashboard. If signup cannot be
disabled, the owner-only data rules below are still essential. Rate-limit login
and password-reset requests.

## 2. Projects, tasks and notes

Apply these rules to **each** of the `projects`, `tasks`, and `notes`
collections, including individual-document reads, collection lists, and realtime
subscriptions:

```text
READ / LIST / SUBSCRIBE:
  allow only if IS_OWNER and the returned document's ownerId == OWNER_ID

CREATE:
  allow only if IS_OWNER
  derive ownerId from the authenticated session on the server
  if the client supplies ownerId, reject a value other than OWNER_ID

UPDATE:
  allow only if IS_OWNER and the existing document's ownerId == OWNER_ID
  do not allow ownerId to be changed

DELETE:
  allow only if IS_OWNER and the existing document's ownerId == OWNER_ID

ALL OTHER ACCESS:
  deny by default
```

The frontend sends `ownerId` when creating a document and needs it returned in
collection responses. The server must validate or overwrite that field; a client
can alter its own requests. The server should also ensure that a task or note's
`project` ID and a task's `linked_notes` IDs refer only to documents owned by
`OWNER_ID`. Assign creation and update timestamps on the server if possible.

## 3. Files and administrative access

- Require `IS_OWNER` for file uploads, listing, and deletion. Enforce ownership
  for downloads too; a URL that anyone can open is not private.
- Ledger currently uses the returned file URL directly in links and previews. It
  cannot attach a bearer token to those navigations or renew expired signed URLs.
  A private/signed download API and corresponding frontend changes may be needed;
  until then, don't upload sensitive attachments to publicly accessible URLs.
- Keep the 50 MB upload limit and delete files only after verifying that no note
  references them. Ledger currently retains files when their note is removed.
- Keep the secret admin key on trusted server-side systems only. The public
  client key identifies the project; it must **not** grant admin access or
  bypass these rules.
- Allow the published site's origin in CORS, along with the necessary request
  methods and `x-api-key`, `Authorization`, and `Content-Type` headers. CORS is
  not an access-control rule; requests outside a browser can ignore it.

## 4. Check the rules before relying on them

1. With no login and only the public key, requests for notes, tasks, projects,
   and private files should be denied without returning their contents.
2. With a different account, list/get/create/update/delete and realtime events
   should be denied, even if the other account knows a document or file ID.
3. With the intended account, verify that loading, creating, editing, deleting,
   and subscriptions work. Changing `ownerId` or linking to another owner's
   document should be rejected.
4. Open an attachment URL in a signed-out/private browser window. If it opens
   without an intentional, time-limited signed URL, treat the file as public.

Do not put an admin key or a password into the website, a public repository, or
chat. If you can share the rule editor's format or documentation, these policies
can be translated into exact BreadBackend rule syntax.
