# BreadBackend rules for Ledger

## Copy the JSON rules

The rules are in [`backend-rules.json`](backend-rules.json). Copy its contents
into the Rules editor for the `kaidaz18-notes` project. They use the JSON
expression format provided for BreadBackend and the selected account email,
`kaioliver111@gmail.com`.

Before saving:

- Back up the existing rules. The supplied file replaces the project rules:
  its default is admin-only, and it explicitly grants client access only to
  `projects`, `tasks`, and `notes`. If this project has other collections or
  apps, merge their rules instead of removing them.
- `version: 5` is taken from the example. If the dashboard requires the current
  rule version or a different version, keep the value it requires.
- Deploy the Ledger update in this branch before or together with the rules.
  Updates must send the existing `ownerId`; older Ledger code omits that field,
  so its updates will be rejected by the new update rules.
- Existing Ledger documents must already have `ownerId` set to the account's
  user ID. Back up and migrate documents without it before enabling the rules.

## What the rules do

- Default reads and writes use `allow: "never"`: the provided documentation
  describes that as blocked for client SDK requests, with the secret admin key
  still able to access them.
- For the three Ledger collections, a rule checks the authenticated email and
  compares `request.auth.uid` with the document's `ownerId`. Creates must carry
  the same owner ID; updates must also carry it and cannot change it. The Ledger
  adapter sends the signed-in user's ID rather than a caller-supplied owner ID.
- The email comparison is exact. Ensure the backend supplies that email in
  `request.auth.email` and enforces unique, verified email addresses. Disable
  public signup where possible. For a rule tied to an immutable account rather
  than an email, add a comparison against the account's stable user ID after
  looking it up in the backend dashboard.

These collection rules do **not** themselves disable registration, validate
cross-document project or linked-note references, or prove that file access and
realtime subscriptions are private. Configure and test those separately.
Never put the password or secret admin key in the website or repository.

## Check the rules before relying on them

The JSON and local mock tests are based on the supplied rule documentation;
they have **not** been installed or verified against the live backend. In
particular, confirm that the server applies custom `read` expressions to each
returned document in collection lists and realtime subscriptions.

1. With no login and only the public key, requests for the three collections
   should be denied without returning document contents.
2. With a different account, try list, individual reads, create, update,
   delete, and realtime subscriptions. None should expose or change the owner's
   data. Also try creating a document with the owner's `ownerId`.
3. With the intended account, verify list, individual reads, creation, edits,
   deletion, and subscriptions. An update attempting to change `ownerId` must be
   rejected. Verify that other collections still have the access you intended.
4. Test file uploads and downloads independently. Open an attachment link in a
   signed-out/private browser window; if it opens without an intentional,
   time-limited signed URL, treat it as public.

Ledger uses the returned file URL directly in links and previews. It cannot
attach bearer headers to those navigations or renew expired signed URLs. A
private/signed download API and corresponding frontend changes may be needed;
until then, do not upload sensitive attachments to public URLs. Ledger retains
files when notes are deleted, so remove unused files only after checking their
references.

Allow the published site origin and required request methods and headers in
CORS, but do not treat CORS as access control. Rate-limit login and password
reset requests, and require email verification where supported.
