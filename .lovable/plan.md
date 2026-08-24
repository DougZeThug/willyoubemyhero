# Streak bonus card shows a text placeholder instead of the art

## What's happening

The bonus card you claimed (Ryan Marquart, rare) does have artwork in the database — the reveal just never shows it.

The milestone reveal screen turns the card to its **back** the moment it appears, and it asks for the card's own back image, which almost no secret card has. With no back artwork it falls through to the generated text panel — the card name and flavour on a blank field. That is the "placeholder with the card's name" you saw. The daily pack reveal doesn't have this problem because it lands on the front art and uses the shared event card back for the reverse.

## The fix

In the milestone reveal:

- Start the card face-down and turn it to the **front art** as the reveal lands, matching the daily pull ceremony.
- Use the shared event card back (the same one the pack uses) for the reverse face instead of the card's rarely-set own back image.
- Keep the tap-to-flip stats panel available after the reveal, so the name/flavour panel is still reachable — just not what greets you.

## Technical detail

- `src/components/milestone-reveal.tsx`: replace the `setFlipped(true)` on reveal with a `faceDown` → front turn (`faceDown={!revealed}`, `flipped={flipped}` driven by `onFlippedChange`), pass the universal back from `useEventCardBack(activeEventId)` as `backUrl`, and keep `backContent={<SecretBackPanel …>}`.
- The event id comes from `useEventBundle` (same source the pack route already uses); when no back image is available the existing generated back stays as the fallback.
- Update `src/components/milestone-reveal.test.tsx` so the reveal assertion checks the front art face rather than the flipped-to-back state.
- No server, RPC or schema changes — `claim_streak_milestone` and `signSecretCard` are already returning the right card and signed art URL.
