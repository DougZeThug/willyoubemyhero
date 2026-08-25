# Trading Post: cleaner, bigger, one offer at a time

The reference shot keeps the same content the trade tab already has, but gives it
room: a gradient title, bigger cards, a glowing frame around the live offer, one
centred action button, and offers shown one at a time with dots instead of a
stack you scroll past.

## What changes

**Header**
- "TRADING POST" gets the two-tone gradient treatment (cyan into gold) at a
  larger display size, with the back link and the explainer copy unchanged.

**Offer cards (Waiting on you / Out there)**
- Each pending offer sits in a glowing cyan-ringed panel instead of the flat
  hairline bezel.
- Title reads `YOU → SAMMI` in heavy display caps; the one-line summary
  ("Lauren Hoffman for Dragon") sits directly under it.
- YOU GIVE / YOU GET become two large columns with a single big card each,
  roughly double today's tile size, with a glowing arrow between them.
- Warnings ("last copy") and the finish label stay under each card.
- The action buttons centre under the cards as one wide pill (Accept / Decline
  side by side for inbox, a single "Take it back" for outbox).
- When more than one offer is pending, they become a swipeable horizontal
  carousel with dot indicators rather than a vertical stack.

**Settled + league feed**
- "Recently settled" and "Around the league" stay compact text-first sections,
  slightly tightened so the pending offer is clearly the loud thing on screen.

**Compose ("Make an offer")** stays functionally identical — same partner chips,
same spare pickers, same rules — just spacing and type sizes brought in line with
the new offer cards.

## Technical notes

- Presentation only: no server functions, RPCs, hooks or schema touched.
- `src/components/trade-offer-card.tsx`: add a `size` (`sm` | `lg`) mode to
  `TradeItemTile`, widen the `Side` columns, restyle the article wrapper with the
  glow ring, and centre the actions row.
- `src/routes/players.trade.tsx`: wrap the inbox/outbox lists in a scroll-snap
  carousel with dots, restyle `Header` and `SectionTitle`.
- Colours come from existing tokens/`oklch` values in `src/styles.css`; if the
  glow ring or gradient text needs a new value, it is added there as a token
  rather than hardcoded in the component.
- Existing e2e selectors in `e2e/trades.spec.ts` are kept working (button text
  and roles unchanged).
