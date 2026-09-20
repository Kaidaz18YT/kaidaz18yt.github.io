# Backend setup (PocketBase `notes` collection)

Server: https://kaidaz18.duckdns.org

## API rules

| Action        | Rule      | Meaning                  |
|---------------|-----------|--------------------------|
| List/Search   | *(empty)* | Anyone                   |
| View          | *(empty)* | Anyone                   |
| Create        | *(empty)* | Anyone                   |
| Update        | `null`    | Superusers only          |
| Delete        | `null`    | Superusers only          |

Empty = public. `null` = locked to superusers. Superusers bypass all rules.

## What the website can and can't do

Can: read everything, create records, subscribe to realtime changes.
Can't: update or delete existing records. "Editing" saves a new version;
"deleting" saves a tombstone version. Real deletion is done in the PocketBase
admin UI. No admin credentials are ever in the website.

## Two things to check in the collection

1. **`text` max length.** A PocketBase text field defaults to 5000 characters
   unless a max is set. Long notes and big projects (many milestones/subtasks)
   can exceed that. Raise the `text` field's Max (e.g. 100000) and then update
   `maxTextLength` in `src/config.ts` to match. The app refuses oversized saves
   with a clear message rather than failing silently.
2. **`created` / `updated` fields.** The app sorts and syncs on `created`.
   Collections made in the admin UI include these autodate fields by default;
   if yours doesn't, add an autodate field named `created` (on create) and
   `updated` (on create and update).

## Public data warning

Because list/view are public, anyone who knows the URL can read every record,
including these tasks and notes. Don't store anything private in them.
