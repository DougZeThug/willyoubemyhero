# Security findings cleanup

Eight warning-level findings are open. Seven are expected behaviour for how this app is built; one is a small real fix.

## The seven "no read policy" warnings

Checked directly against the live database: `card_mints`, `card_pulls`, `dust_ledger`, `secret_card_pulls`, `secret_cards` and `streak_milestone_claims` are unreadable by public visitors and signed-in visitors alike, and none has a read rule. That is exactly the design here — every card, pack, trade, dust and streak read goes through the app's own server code, which uses the privileged backend connection and checks the caller's admin or member token first. Adding read rules would open card ownership and pull history straight to the browser, which the app deliberately does not do.

One nuance found while checking: `secret_collections` still carries a leftover read grant for visitors, but with no read rule in place nothing can actually be read. Tightening that grant is optional and changes nothing user-facing.

Action: mark these seven as intentional (ignore), and record the reasoning in the security memory so future scans do not re-raise them.

## The real fix: two database helpers without a fixed lookup path

Two helper functions do not pin their schema lookup path:

- `roll_card_edition(uuid, uuid, date)`
- `mill_value(text)`

Both are ordinary (non-privileged) helpers, so the risk is low, but they are called from privileged card and dust functions, so they should be pinned like every other function in the schema.

Action: one migration that sets `search_path = public` on both, leaving their bodies untouched.

## Technical detail

```sql
ALTER FUNCTION public.roll_card_edition(uuid, uuid, date) SET search_path = public;
ALTER FUNCTION public.mill_value(text) SET search_path = public;
```

No application code changes. After the migration, re-run the linter and mark the search-path finding fixed, then ignore the seven read-policy findings with the rationale above and update the security memory document.
