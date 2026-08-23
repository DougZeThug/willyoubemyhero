# Put Alex Manning and Robert Wolgemuth back in the vault

## What happened

Both men are still on the roster, but neither has an entry in the 2026 event any
more — the event has 16 players and they are not among them. Removing a player
from an event hard-deletes that row, and every card table hangs off it with a
cascade, so the delete took their `card_copies`, `card_pulls`, reactions and
comments with it. That is why their cards vanished from everybody's collection
at once.

Their artwork survived: the card fronts are still in storage (verified by
opening them — Alex Manning's gold "Timekeeper King" card and Robert
Wolgemuth's pink "Cerebral QB" card, plus their resized variants).

There is no surviving record of who owned which copy: no archive snapshot, and
the audit log only holds run edits. So ownership has to be re-granted by hand
rather than restored.

## The fix

**1. Put both back on the 2026 roster as non-competing.**
Re-insert their `event_participants` rows with a non-competing status and
running order after the current 16, and point `card_path` (plus the thumb and
medium variants) at the files already in storage. Their cards reappear in the
vault, are packable again, and their card pages work.

**2. Stop the delete from ever eating cards again.**
`removeParticipantFromEvent` in `src/lib/admin-write.functions.ts` currently
deletes the roster row outright. It will first check for any `card_copies` or
`card_pulls` on that row; if any exist, it flips the player to a non-competing
status instead of deleting, and tells the admin that is what it did. Only a
player nobody has packed can still be removed cleanly.

**3. Hand the copies back.**
The existing commissioner grant panel already assigns a named player specific
base cards, recorded as a grant rather than a pull so the public "Packed by N"
counts stay honest. Use it for anyone who tells you they had Manning or
Wolgemuth. I can also do a one-off grant round for a list of names you give me.

## Technical notes

- Restoration is a data change: insert two `event_participants` rows for event
  `11111111-...-111111111111`, `participation_status` non-competing,
  `running_order` 17 and 18, with the existing storage paths
  (`cards/<event>/9a0f1a50-…` for Manning, `…/1317bc98-…` for Wolgemuth) —
  the file names carry the old event-participant ids, so the paths are reused
  as-is rather than re-uploaded.
- Guard in `removeParticipantFromEvent`: count `card_copies` and `card_pulls`
  by `event_participant_id` before deleting; on a non-zero count, update
  `participation_status` and return a flag the admin UI surfaces as a toast.
- No schema change and no migration needed.
