# Get Dave back onto his cards, and let you re-issue one player's code

## What actually happened

Dave's cards are not gone. All **13 secret cards** sit safely on his player
record — I checked. What his phone lost is the *proof that it is him*. Since the
code re-issue his handset has been an anonymous visitor, and the merge moved the
cards off that anonymous visitor and onto his real player. So the phone now shows
an empty shelf while the collection is intact one step away.

He gets it back the moment that phone claims his player again (or signs into an
account, which then survives future code re-issues).

## Why you can't re-issue his code

The Member Codes panel only offers two buttons:

- **Issue codes for unclaimed** — skips Dave, because his record still counts as
  claimed from 31 July.
- **Re-issue ALL** — works, but burns everybody else's code at the same time.

There is no "just this one player" option in the UI, even though the underlying
code-issuing already supports naming specific players.

## The fix

1. **Add a per-player "Issue code" action** to the roster list inside Member
   Codes. Tap a player, confirm, and a single fresh code is generated and shown
   for that player alone — nobody else's code changes. Works for claimed and
   unclaimed players alike, which is exactly the Dave case.
2. **Show the newly issued code inline** next to that player (same one-time
   reveal and copy behaviour as the bulk list, since only the hash is stored).
3. **Use it for Dave**: issue his code, he enters it on `/claim`, and his 13
   secrets and roster cards reappear. Then have him sign in on that phone so a
   future re-issue can never orphan him again.

## Technical detail

- `generateMemberCodes` already accepts `participantIds`; the per-player path
  needs no server change, only a UI call passing a single id.
- Issuing resets that row's `claimed_at` / `claim_count` for that player only —
  intended, so the new code can be claimed.
- Change is confined to `src/components/member-admin-panel.tsx`.
