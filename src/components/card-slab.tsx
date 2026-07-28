import type { ReactNode } from "react";
import type { CollectedCard } from "@/lib/card-collection";

/**
 * The acrylic case a graded card ships in.
 *
 * Purely presentational — it wraps whatever card you hand it and adds the
 * furniture a slab has: a label bar across the top carrying the event, the
 * serial, and whether this device has pulled the card. No new data; the serial
 * is the player's running order over the roster size, which is already the
 * number printed on the physical card.
 *
 * Nothing here sits over the card. The grade is not repeated on the plate —
 * the tier ribbon above the slab already carries the label and why it was
 * earned — and the collection mark rides in the plate rather than stamped
 * across the art's top corner, where it clipped the card on a phone.
 *
 * The case deliberately does not intercept pointer events anywhere over the
 * card itself — the whole point of the page is handling the card, and a frame
 * that ate the gesture would be a downgrade dressed as a feature.
 */
export function CardSlab({
  eventName,
  eventYear,
  serial,
  ofTotal,
  collected,
  children,
}: {
  eventName: string;
  eventYear: number | null;
  serial: number;
  ofTotal: number;
  /** This device's collection entry, if the card has ever been pulled. */
  collected: CollectedCard | null;
  children: ReactNode;
}) {
  return (
    <div
      className="rounded-2xl border p-2 pb-3"
      style={{
        borderColor: "color-mix(in oklab, var(--tier) 35%, transparent)",
        background:
          "linear-gradient(180deg, color-mix(in oklab, var(--tier) 8%, transparent) 0%, transparent 55%)",
        boxShadow: "0 0 40px -18px var(--tier)",
      }}
    >
      {/*
        One line, three parts: collection mark, event, serial. The tier badge
        above the card already carries the grade and why it was earned, so
        repeating either here would just be noise — this is the serial plate,
        not a second label.
      */}
      <div className="mb-2 flex items-baseline gap-2 px-1.5">
        <CollectionMark collected={collected} />
        <span className="min-w-0 flex-1 truncate text-center text-[8px] font-bold uppercase tracking-[0.15em] text-muted-foreground">
          {slabTitle(eventName, eventYear)}
        </span>
        <span className="font-display shrink-0 text-[10px] font-black uppercase tracking-[0.2em] text-foreground/80">
          {serial}
          <span className="text-muted-foreground">/{ofTotal}</span>
        </span>
      </div>

      {children}
    </div>
  );
}

/**
 * Event line for the slab plate.
 *
 * Events are usually named with the year already in them ("… Draft Combine
 * 2026"), and appending `event.year` on top of that printed "2026 2026".
 */
function slabTitle(eventName: string, eventYear: number | null): string {
  const year = eventYear ? String(eventYear) : "";
  if (!year || eventName.includes(year)) return eventName;
  return `${eventName} ${year}`;
}

/**
 * Whether this device has pulled the card, in the plate's left slot.
 *
 * Absent rather than negative when the card has not been pulled. Every card in
 * the vault is browsable whether or not you own it, so a card with no mark is
 * the ordinary case and does not need labelling — and there is no "New" state,
 * because looking at a card is no longer how you collect one.
 */
function CollectionMark({ collected }: { collected: CollectedCard | null }) {
  if (!collected) return null;
  return (
    <span
      className="font-display shrink-0 text-[10px] font-black uppercase tracking-[0.2em]"
      style={{ color: "var(--tier)" }}
    >
      {collected.count > 1 ? `Pulled ×${collected.count}` : "Collected"}
    </span>
  );
}
