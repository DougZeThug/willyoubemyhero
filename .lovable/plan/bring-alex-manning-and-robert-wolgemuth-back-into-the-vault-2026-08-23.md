# Bring Alex Manning and Robert Wolgemuth back into the vault

## What I found

Both men still exist on the league roster (`participants`), but neither has a row
in the event's roster for the 2026 combine — the event currently has 16 players
and neither of them is one. That row is the card. Everything about a card hangs
off it: the artwork paths, who has packed it (`card_pulls`), every copy anybody
owns (`card_copies`), and its reactions and comments.

Every one of those links is `ON DELETE CASCADE`. So the moment their event-roster
entry was removed — the admin "remove from event" control does a hard delete —
the database silently deleted their cards out of everybody's collection too.
That is why they vanished from collections rather than just from the results.

There is no archive snapshot and no audit row for the removal, so the old copies
cannot be read back from anywhere. The cards have to be re-created and re-issued.

## The fix

**1. Put them back on the event roster as non-competing.**
Re-add Alex Manning and Robert Wolgemuth as event participants with a status that
keeps them out of the results and leaderboard (they didn't run) while making them
real cards again in the vault.

**2. Re-attach their card artwork.**
Their images are almost certainly still in storage — the files were never deleted,
only the row pointing at them. I'll look for the existing files and re-link them.
If the paths are genuinely gone, you upload the two card fronts in the admin
roster panel as normal.

**3. Give the cards back to the people who had them.**
Since the copies were deleted, the honest route is the commissioner grant control
that already exists: hand each affected player the two cards back, recorded as a
grant rather than a pull so the public "Packed by N" counts stay truthful. I can
apply a blanket restore (every claimed member who was in the league at the time
gets one of each) or you can name who had them — your call, see the question below.

**4. Stop this happening again.**
Make "remove from event" refuse to hard-delete a card anybody owns. Instead it
marks the player as not competing, so they disappear from timing and results but
their card, and everybody's copies of it, survive. Removing a card outright stays
possible only when nobody holds a copy.

## Technical notes

- `removeParticipantFromEvent` in `src/lib/admin-write.functions.ts` gains a
  pre-check on `card_copies` / `card_pulls` for that `event_participant_id`; when
  either is non-empty it flips `participation_status` to a non-competing value
  instead of deleting, and returns a message the admin panel surfaces.
- Re-adding uses the existing `addParticipantToEvent` path; new `event_participants`
  rows get fresh ids, so the old copies could not have been recovered by id anyway.
- Restoring copies reuses the `grant_card_copy` RPC (`source = 'grant'`) plus
  `resync_card_pull`, the same route used previously for Dave and Ryan.
- Non-competing players must stay out of `runs`-derived views: leaderboard, live
  and results already filter on runs, so no change is expected there — I'll verify
  the vault, leaderboard and draft screens after re-adding.
