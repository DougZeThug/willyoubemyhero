Make secret cards bigger and more readable when tapped

Goal: when a user taps a secret card in the vault (or the finished pack), the sheet that opens should show the card at a size that is comfortable to read on a phone, rather than the current small `max-w-[260px]` thumbnail.

## Current state
- `SecretCardSheet` is the dialog shown when a secret card is clicked.
- The dialog is capped at `max-w-sm` and the card inside is capped at `max-w-[260px]`.
- `SecretBackPanel` uses tiny type (`text-[8px]`, `text-[10px]`, `text-base`) that is hard to read at the current size.

## Changes

### 1. Enlarge the secret-card sheet
- Change `DialogContent` in `SecretCardSheet` to use a responsive width: full bleed on small screens (`max-w-[92vw]`) up to a comfortable cap on desktop (`md:max-w-lg`).
- Reduce internal padding on mobile so the card can grow.

### 2. Make the card inside the sheet fill the new width
- Replace the fixed `max-w-[260px]` wrapper with a responsive width: `w-full max-w-[320px] sm:max-w-[420px]`.
- Keep the card centered and preserve its aspect ratio.

### 3. Add a readable size variant to the back panel
- Introduce a `size` prop on `SecretBackPanel` (default `small`, sheet uses `large`).
- In `large` mode scale up:
  - rarity label to `text-xs`/`tracking-[0.25em]`,
  - card name to `text-xl`/`font-black`,
  - flavour text to `text-sm` leading-relaxed,
  - footer labels to `text-xs`.
- Keep `small` unchanged for the pack page fourth slot.

### 4. Polish the sheet content
- Increase title size in `SecretCardSheet` to `text-2xl` on mobile.
- Slightly increase the pulled-date / owner-count captions.
- Ensure the close button remains reachable without overlapping the card.

### 5. Verification
- Run `bun run lint` and `bun run typecheck`.
- Open the preview on a phone-sized viewport, tap a secret card in the vault, and confirm the enlarged sheet renders without overflow or clipped text.
