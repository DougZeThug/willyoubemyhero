# Slower, brighter pack ceremony

Two changes: give the sequence more room to breathe, and add the light and
celebration payoff that is currently missing once the pack is open.

## Timing

Total goes from 2.82s to roughly 4.0s, spent only on phases that are visibly
changing, so it reads as slow-motion rather than as a pause:

| Phase      | Now  | New  |
| ---------- | ---- | ---- |
| anticipate | 150  | 220  |
| seam       | 220  | 320  |
| rip        | 260  | 380  |
| peel       | 420  | 620  |
| launch     | 480  | 700  |
| fan        | 600  | 820  |
| hold       | 320  | 560  |
| handoff    | 300  | 380  |

Card springs and the per-card stagger in `pack-opening.tsx` scale with the
longer phases so nothing arrives early and then sits still. Skip stays on
screen the whole time.

## Light and celebration

Today the only light is a single 0.25s flash clipped to the tear mouth. Adding:

- Mouth light that sustains through `peel` into `launch` instead of flashing —
  it swells as the shards leave, then is occluded as the cards climb out of it.
- God rays: a few soft, clipped beams fanning up out of the tear during `peel`,
  fading by mid `launch`. Screen blend, seeded off the pack so it is stable.
- A bloom pulse on the fan as it spreads, tinted by the best rarity in the pack
  (secret pulls get the strongest wash), peaking on the `hold` beat.
- Sparkle motes: a dozen small seeded particles drifting up from the mouth
  through `launch` and `fan`, dying before `handoff`.
- A brief edge-light sweep across each card face as it reaches its fan pose, so
  the foil reads as catching light rather than being a static gradient.
- Existing haptics/SFX cues are re-timed to the new phase starts.

Everything above is skipped entirely under `prefers-reduced-motion`, matching
how the current effects are gated.

## Technical notes

- `src/lib/pack-ceremony.ts`: new phase durations; `CEREMONY_MS` stays derived.
  Fan spread and tilt are unchanged.
- `src/components/pack-opening.tsx`: stagger steps, spring tuning, bloom and
  mote layers behind the cards; rarity tint chosen from the pulled cards.
- `src/components/pack-wrapper.tsx`: mouth light becomes phase-driven, plus the
  ray layer clipped to the same tear path.
- `src/lib/pack-ceremony.test.ts` updated for the new totals and phase bounds.
- Verified with a Playwright filmstrip at 360x629 to confirm the rip, rays and
  fan each get visible frames.
