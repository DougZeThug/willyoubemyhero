import type { ReactNode } from "react";
import type { Rarity } from "@/lib/card-rarity";
import type { CollectedCard } from "@/lib/card-collection";
import { cn } from "@/lib/utils";

/**
 * The acrylic case a graded card ships in.
 *
 * Purely presentational — it wraps whatever card you hand it and adds the
 * furniture a slab has: a label bar across the top with the grade and the event,
 * a serial down the side, and a collection stamp in the corner. No new data;
 * the serial is the player's running order over the roster size, which is
 * already the number printed on the physical card.
 *
 * The case deliberately does not intercept pointer events anywhere over the
 * card itself — the whole point of the page is handling the card, and a frame
 * that ate the gesture would be a downgrade dressed as a feature.
 */
export function CardSlab({
  rarity,
  eventName,
  eventYear,
  serial,
  ofTotal,
  collected,
  children,
}: {
  rarity: Rarity;
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
        One line, three parts. The tier badge above the card already carries the
        grade and why it was earned, so repeating either here would just be
        noise — this is the serial plate, not a second label.
      */}
      <div className="mb-2 flex items-baseline gap-2 px-1.5">
        <span
          className="font-display shrink-0 text-[10px] font-black uppercase tracking-[0.25em]"
          style={{ color: "var(--tier)" }}
        >
          {rarity.label}
        </span>
        <span className="min-w-0 flex-1 truncate text-center text-[8px] font-bold uppercase tracking-[0.15em] text-muted-foreground">
          {slabTitle(eventName, eventYear)}
        </span>
        <span className="font-display shrink-0 text-[10px] font-black uppercase tracking-[0.2em] text-foreground/80">
          {serial}
          <span className="text-muted-foreground">/{ofTotal}</span>
        </span>
      </div>

      <div className="relative">
        {children}
        <CollectionStamp collected={collected} />
      </div>
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
 * Corner stamp saying whether this device has pulled the card before.
 *
 * The collection has existed since the pack page shipped and the vault counts
 * it, but the card's own page never said a word about it — you could stare at a
 * card you had never pulled and get no signal either way.
 */
function CollectionStamp({ collected }: { collected: CollectedCard | null }) {
  const isNew = !collected;
  return (
    <div
      className={cn(
        "pointer-events-none absolute -right-1 -top-1 rotate-6 rounded-md border px-2 py-0.5",
        "font-display text-[9px] font-black uppercase tracking-[0.2em] backdrop-blur-sm",
      )}
      style={{
        borderColor: isNew ? "var(--tier)" : "oklch(1 0 0 / 20%)",
        background: isNew
          ? "color-mix(in oklab, var(--tier) 22%, oklch(0.14 0.02 240))"
          : "oklch(0.14 0.02 240 / 85%)",
        color: isNew ? "var(--tier)" : "oklch(0.74 0.03 220)",
      }}
    >
      {isNew ? "New" : collected.count > 1 ? `Pulled ×${collected.count}` : "Collected"}
    </div>
  );
}
