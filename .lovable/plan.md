# Apply the prompt studio schema to the live database

The prompt studio code merged in, but the database it talks to never received the
matching schema change — which is why the admin console shows
"Could not find the table 'public.card_prompt_templates'".

## What happens

Apply the already-written migration `20260810190000_card_prompt_studio.sql`
byte-for-byte through the migration tool. It:

- Creates the **card prompt templates** table (slug, name, master prompt, active,
  sort order) with the updated-at trigger, and seeds the six built-in templates:
  Draft Combine Player, Cornhole Player, Secret Pet, Legacy Pet, WAG Secret Rare,
  Custom Secret.
- Creates the **card prompt runs** history table (template snapshot, event,
  participant, subject, input snapshot, generated prompt, initial/revision kind,
  parent prompt, revision instruction) with an index for newest-first per event.
- Locks both tables down: row level security on, no public or signed-in access,
  access only for the server. All reads and writes stay behind the existing
  league-admin and event-admin guards in the prompt studio server functions.

Everything else in the merge (secret card collections, foil/border) is already
present in the database — no further changes needed.

## After it runs

No app code changes are required; the studio's Save and history views start
working immediately. Verify by opening the admin console prompt studio, saving a
template edit, and confirming the history list loads.
