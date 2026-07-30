import { resolveSlot, type CardLayout, type SlotContext, type StatSlot } from "@/lib/card-layout";

/**
 * Live numbers, drawn on top of the card art.
 *
 * The front's counterpart to CardBackPanel, with one difference that shapes the
 * whole file: this sits over somebody's artwork rather than over a panel we own,
 * so it may not take a pixel it was not given. Slots come from the layout the
 * admin calibrated against that exact art, and nothing outside a slot is drawn.
 *
 * Sizing is in `cqw` against a container query, not from a measured width. A
 * .holo-face is rotated with backface-visibility hidden, and anything that tries
 * to measure it reads zero — the same trap that keeps recharts off the card back.
 * Container queries resolve at layout, before any of that applies.
 */
export function CardFrontPanel({
  layout,
  context,
  tierColor,
  compact = false,
}: {
  layout: CardLayout | null;
  context: SlotContext;
  /** Resolved colour for slots that asked to follow the rarity accent. */
  tierColor: string;
  /**
   * Thumbnail mode: the overall only.
   *
   * The vault mounts thirty of these at ~150px wide, where a five-slot stat
   * strip is unreadable texture and thirty of them is real paint cost. The one
   * number worth carrying at that size is the headline.
   */
  compact?: boolean;
}) {
  if (!layout) return null;
  const slots = compact ? layout.slots.filter((s) => s.key === "ovr") : layout.slots;
  if (slots.length === 0) return null;

  return (
    <div
      aria-hidden
      // The card is meant to be picked up and tilted; a stat layer that caught
      // the gesture would break the one interaction the page is built around.
      // Same rule the slab follows.
      className="pointer-events-none absolute inset-0"
      style={{ containerType: "inline-size" }}
    >
      {slots.map((slot) => (
        <Slot key={slot.id} slot={slot} context={context} tierColor={tierColor} />
      ))}
    </div>
  );
}

function Slot({
  slot,
  context,
  tierColor,
}: {
  slot: StatSlot;
  context: SlotContext;
  tierColor: string;
}) {
  const value = resolveSlot(slot.key, context);
  const color = slot.color === "tier" ? tierColor : (slot.color ?? "oklch(0.98 0 0)");
  const items =
    slot.align === "left" ? "flex-start" : slot.align === "right" ? "flex-end" : "center";

  return (
    <div
      style={{
        position: "absolute",
        left: `${slot.x * 100}%`,
        top: `${slot.y * 100}%`,
        width: `${slot.w * 100}%`,
        height: `${slot.h * 100}%`,
        display: "flex",
        flexDirection: "column",
        alignItems: items,
        justifyContent: "center",
        overflow: "hidden",
        background: slot.plate?.color,
        borderRadius: slot.plate ? `${(slot.plate.radius ?? 0) * 100}cqw` : undefined,
      }}
    >
      {slot.label && (
        <span
          style={{
            fontSize: `${slot.size * 40}cqw`,
            lineHeight: 1,
            fontWeight: 700,
            letterSpacing: "0.15em",
            textTransform: "uppercase",
            color: "oklch(1 0 0 / 55%)",
            whiteSpace: "nowrap",
          }}
        >
          {slot.label}
        </span>
      )}
      <span
        style={{
          fontSize: `${slot.size * 100}cqw`,
          lineHeight: 1.05,
          fontWeight: 900,
          color,
          whiteSpace: "nowrap",
          // The values are numbers that change while you are looking at them.
          // Tabular figures stop the box jittering as the digits swap.
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
    </div>
  );
}
