# Redesign: Card Ownership Audit (admin)

The panel currently dumps three long blocks on a phone: 24 loose-device cards each
with a full-width dropdown, a run-on list of unreachable names, and a four-column
table that squeezes long names into three lines. Goal: same information, far less
scrolling, readable at 360px.

## What changes

**1. Three tabs instead of three stacked blocks**
One segmented control at the top: `Loose devices (24)` · `Can't trade (8)` · `Who holds what`.
Only one list renders at a time, so the section is short by default.

**2. Loose devices — collapsed rows, expand to fix**
Each device becomes a compact one-tap row: short id, a bold `11 secrets · 1 pack`
badge, and the date range. The "Belongs to…" picker and Attach button only appear
once the row is expanded, so the default view is a scannable list rather than 24
form controls. Card-name samples move inside the expanded state.
Sorted by secrets held, as today.

**3. Can't receive offers — proper list**
Replace the single run-on paragraph with a wrapped chip list, one name per chip,
so nobody's name splits across lines.

**4. Who holds what — cards, not a table**
Drop the horizontally-cramped table on phones. Each player becomes a row:
name (with a warning icon if unreachable) on the left, and three small labelled
stats — Cards / Secrets / Tradeable — right-aligned as compact stat pills.
Players with zero of everything are folded into a collapsed "No cards yet (9)"
group at the bottom so the active collectors are visible without scrolling.
At `md:` and wider the existing table layout is kept.

**5. Small readability fixes**
Bump the smallest text (currently 10–11px) to 12px for values, keep the
uppercase micro-labels only for headers, and add a "Refresh" affordance so the
30s-stale query can be re-pulled after attaching a device.

## Scope

Presentation only — `src/components/ownership-audit-panel.tsx`. No changes to
`src/lib/ownership-audit.functions.ts`, the attach flow, or any server logic.
The existing confirm-before-attach guard stays.

## Note

The first row in the "Who holds what" screenshot is the event name
("2026 Will YOU be my Hero Draft Combine") sitting in the participant list with
zero cards. That looks like a stray data row rather than a layout bug; the
grouping above will hide it, but if you want it actually removed from the roster
that's a separate data fix — say the word and I'll investigate it.
