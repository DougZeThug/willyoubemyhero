# Why the pack opening looked like "nothing", and how to prove it

You opened a fresh pack with Reduce Motion off, so the ceremony should have run in full.
The merge that added it is on the branch (`Merge pull request #25 ... pack-opening-animation`),
so the code is there. What is not yet confirmed is what actually rendered on your phone.

One thing is certain from the code as it stands: the whole ceremony now runs in
**2.05 seconds**, end to end — anticipate 120ms, seam 180, rip 200, peel 250,
launch 380, fan 420, hold 200, handoff 300. That is deliberately half of the
earlier 4.3s cut, and on a phone it is easy to blink past the tear, the shard
peel and the fan and register only "cards appeared".

## Step 1 — capture it, frame by frame (no code changes)

Drive the pack screen in a headless browser, tear the pack, and screenshot every
~100ms across the full 2s. That gives an actual filmstrip of: seam glow, strip
shards, light out of the mouth, cards rising, the fan, the hold, and the handoff
into the stand. Any phase that renders nothing shows up immediately, and we stop
guessing.

## Step 2 — fix whichever of these the filmstrip shows

- **Phases render but are too fast to read.** Re-time the table toward roughly
  3s, putting the extra time only into phases that visibly evolve (peel, launch,
  fan) and leaving the dead-beat `hold` short.
- **A phase renders nothing** (e.g. shards or mouth light missing). Fix that
  layer specifically in `pack-opening.tsx`.
- **Cards jump instead of flying.** Springs are outrunning their phase; adjust
  the stiffness/damping so each move finishes inside its slot.
- **No sound.** Audio needs a user gesture to unlock; if the cues never fire,
  wire the unlock to the first tap on the pack.

## Step 3 — confirm on a real phone-sized viewport

Re-run the capture at 360x629 (your viewport) and check the fan stays inside the
pack column, since anything that escapes is clipped rather than scrollable.

## Technical notes

- Timeline lives in `src/lib/pack-ceremony.ts` (`CEREMONY` table is the single
  source of truth; `CEREMONY_MS` and `CEREMONY_START` derive from it).
- Rendering and the clock live in `src/components/pack-opening.tsx`; the handoff
  into `pack-stand.tsx` is measured, not derived.
- Sound cues are `packHandle`, `seamTension`, `packOpen`, `packBurst`,
  `deckGather` in `src/lib/card-sfx.ts`.
- Existing tests (`pack-ceremony.test.ts`, `pack-opening.test.tsx`) pin phase
  order and the reduced-motion path; any re-timing keeps those green.
