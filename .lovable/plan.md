# Streak card art: get the fix live, and make it impossible to land on the text panel

Streak rewards work as designed (each rung pays once — you hit Day 3 and Day 7 on the same run), so nothing changes there.

## What's actually wrong with the art

The card you claimed does have artwork — `Dave Stoltzfus` has an art file and no back file of its own. The reveal that greeted you was the generated name/flavour panel, which is what the milestone reveal used to turn onto.

That was already fixed in the editor: the reveal now lands face-down on the event's shared back and turns onto the front art. The screen you photographed came from the published site, which is still running the old build — the fix has not been published.

## What to do

1. Publish the current build so the corrected reveal reaches phones.
2. Harden the reveal so this can never regress into a text panel:
   - If the event has no shared back image, skip the face-down beat entirely and open straight on the front art.
   - Keep the generated name/flavour panel only as the tap-to-flip reverse.
3. Verify in the preview that a claimed milestone card shows the artwork, and that tapping it still reaches the name/flavour panel.

## Technical detail

- `src/components/milestone-reveal.tsx`: initialise `revealed` to `true` when no `universalBack` is supplied, so `faceDown` is never set on a card with nothing to show face-down.
- No server, RPC or schema changes; `claim_streak_milestone` and `signSecretCard` already return the right card and a signed art URL.
- `src/components/milestone-reveal.test.tsx`: add a case covering the no-shared-back path opening on the front art.
