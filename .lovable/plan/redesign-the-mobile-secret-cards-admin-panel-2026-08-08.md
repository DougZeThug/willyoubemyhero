# Redesign the mobile Secret Cards admin panel

Keep every current colour, token and visual style. This is a layout and control-density
change to the Secret Cards section of the admin console so card art is easier to upload,
identify and manage from a phone.

## What changes

### 1. Upload zone
- Bigger, calmer drop target with a cloud upload icon above the label.
- Copy stack: "Drop card art here" (desktop) / "Tap to add card art" (phone), then a
  one-line hint (filename becomes the name, PNG/JPEG/WebP, up to 8.8 MB, portrait 5:7).
- Add an explicit **Browse Files** button inside the zone so the tap target is obvious
  on mobile instead of relying on the whole panel being clickable.
- Show a small staged/uploading counter while drafts are pending.

### 2. Card rows become card tiles
Each secret card gets a self-contained tile instead of the current cramped flex row:

```text
┌──────────────────────────────────────────────┐
│ ┌──────┐  ASHLEY MARQUART            (pencil)│
│ │ 5:7  │  No wording yet                     │
│ │ art  │  Pulled by 1 of 4                   │
│ └──────┘                                     │
│  Weight [ 100 ]      Foil   [ Ultraviolet v ]│
│  Border [ Prism  v ] [ Grant ] [ Grant to… v]│
└──────────────────────────────────────────────┘
```

- Thumbnail becomes a portrait 5:7 card preview (matching the app-wide card ratio),
  larger than today's 44px square, with the existing "No art" placeholder styling.
- Name on its own line at readable size; wording and owner count beneath it.
- A single round icon button top-right opens an **edit sheet** for that card.

### 3. Controls: labelled two-column grid on phones
- `Weight`, `Foil`, `Border`, and the grant control sit in a labelled
  two-column grid (`grid-cols-2` on phones, current inline flow from `sm:` up).
- On phones the foil and border chip strips collapse into compact labelled
  dropdowns (the same option lists from `SECRET_FOIL_OPTIONS` /
  `SECRET_BORDER_FX_OPTIONS`), with the current selection's swatch shown next to the
  trigger so nothing is lost. The full visual chip strips stay on `sm:` and up, and
  are also available inside the edit sheet on mobile.
- Grant keeps its participant picker + Grant button, now on one aligned row.
- All existing save behaviour is untouched: weight saves on blur/enter, look saves on
  change through the per-card queue, same toasts and per-row spinners.

### 4. Edit sheet (mobile management)
The pencil opens a sheet containing, for that card: name, wording, replace-art,
the full foil/border chip strips, weight, grant, and Remove. This puts every
per-card action in one reachable place instead of three tiny icon taps in a row.
Desktop keeps inline editing as it is today.

### 5. Draft rows
Staged (not yet saved) cards get the same tile shape with a live thumbnail preview of the
chosen file, plus name/wording inputs and a per-draft remove control. Sticky
"Cancel / Add to the set" action row at the bottom of the draft list.

## Technical notes
- Work is confined to `src/components/secret-cards-panel.tsx`, with a small extracted
  `SecretCardTile` (and mobile edit sheet) component in the same folder to keep the file
  manageable; `secret-look-picker.tsx` gains a compact `select`-style variant used only
  below `sm`.
- No server function, schema, or `secret-cards.functions.ts` changes.
- No new colours: reuse existing tokens (`primary`, `warn`, `muted-foreground`,
  `border-white/10`, `hud-bezel`).
- Uses `Sheet` from shadcn (already available under `src/components/ui`).
- Responsive rules follow the project pattern: `grid-cols-[minmax(0,1fr)_auto]` headers,
  `min-w-0` on text containers, `shrink-0` on thumbnails, `min-h-11` touch targets,
  and `text-base` on mobile inputs so iOS doesn't zoom.
- Verify with `bun run format`, `bun run lint`, `bun run typecheck`, and a 360px-wide
  preview pass over the admin console.
