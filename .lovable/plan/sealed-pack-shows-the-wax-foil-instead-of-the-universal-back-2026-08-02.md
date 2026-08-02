# Sealed pack shows the wax foil instead of the universal back

## What's happening

The event does have a universal back uploaded (only the full-size version exists;
the thumb/medium variants were never generated), and the pack page already passes
that back into `PackWrapper`. So the wiring is right — but the sealed pack in the
screenshot shows neither the artwork nor the fallback "Will YOU Be My Hero? /
Draft Combine" lettering.

That combination points at the pack face's image: it starts at `opacity-0` and
only fades in via `onLoad`, while the lettering is hidden as soon as an art URL
merely *exists*. If the image never finishes loading (slow signed URL, a request
that errors, or a decode failure), the result is exactly what the screenshot
shows — an empty foil panel.

This diagnosis is not yet proven, so step 1 is to confirm it.

## Plan

### 1. Confirm the cause
Load the pack page in a headless browser, watch the network request for the
signed back-image URL, and record whether it 200s and whether the `<img>` ever
fires `load`. That tells us whether this is a load failure or something upstream
(missing/expired signed URL).

### 2. Make the pack face honest about load state
In `src/components/pack-wrapper.tsx`, `PackFace` should track the image's real
state rather than assume success:
- keep the lettering visible until the image has actually loaded,
- on an image error, drop back to the wax-foil + lettering permanently for that
  render instead of leaving a blank panel.

This makes the sealed pack correct no matter which way the fetch goes.

### 3. Fix whatever step 1 turns up
- If the signed URL is failing, fix it at the source in `getEventCardBack` /
  `signPath`.
- If the missing thumb/medium variants are implicated, backfill them with the
  existing "Regenerate image sizes" admin action rather than new code.

### 4. Verify
`bun run lint`, `bun run typecheck`, `bun run test`, then reload the pack page at
360px wide and confirm the universal back is printed on the sealed pack before
the rip.

## Out of scope
- Changing the tear gesture, pack sizing, or the reveal ceremony.
- Any change to how backs are uploaded or stored.
