import { useEffect, useRef } from "react";
import { HoloCard } from "@/components/holo-card";
import { initialsOf } from "@/lib/format";
import type { Rarity } from "@/lib/card-rarity";
import { cn } from "@/lib/utils";

export type FilmstripEntry = {
  id: string;
  name: string;
  frontUrl: string | null;
  rarity: Rarity;
};

/**
 * The roster as a scrolling strip of thumbnails under the hero card.
 *
 * This is the phone's primary way to move between cards. It cannot be a swipe
 * across the card itself: a hero card sets `touch-action: none` and claims the
 * entire gesture, deliberately — see the long note in holo-card.tsx about why
 * there is no adaptive middle ground. So navigation gets its own surface, which
 * also happens to make the roster feel like a set you're flipping through
 * rather than a list you left behind.
 *
 * Thumbnails use the vault grid's settings (`subtle`, non-interactive): no
 * tilt, half the foil, no extra compositor layers for eighteen cards that are
 * only there to be tapped.
 */
export function RosterFilmstrip({
  entries,
  currentId,
  onSelect,
}: {
  entries: FilmstripEntry[];
  currentId: string;
  onSelect: (id: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  // Keep the current card in view however it was reached — a tap on the strip,
  // an arrow key, or the chevrons either side of the hero card.
  useEffect(() => {
    const el = activeRef.current;
    const scroller = scrollRef.current;
    if (!el || !scroller) return;
    const target = el.offsetLeft - scroller.clientWidth / 2 + el.clientWidth / 2;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    // scrollTo on the scroller, not scrollIntoView: the latter also scrolls the
    // page vertically to bring the strip into view, which yanks the hero card
    // off screen every time you press an arrow key.
    scroller.scrollTo({ left: Math.max(0, target), behavior: reduced ? "auto" : "smooth" });
  }, [currentId]);

  if (entries.length < 2) return null;

  return (
    <div className="mt-6">
      <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.3em] text-muted-foreground">
        The Set
      </div>
      <div
        ref={scrollRef}
        // pan-x, not none: this strip wants the horizontal gesture and nothing
        // else, so a vertical drag still scrolls the page underneath it.
        className="-mx-4 flex touch-pan-x snap-x snap-mandatory gap-2.5 overflow-x-auto px-4 pb-2"
      >
        {entries.map((entry) => {
          const active = entry.id === currentId;
          return (
            <button
              key={entry.id}
              ref={active ? activeRef : undefined}
              onClick={() => onSelect(entry.id)}
              aria-label={`Show ${entry.name}`}
              aria-current={active ? "true" : undefined}
              className={cn(
                "w-16 shrink-0 snap-center rounded-lg transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                active ? "opacity-100" : "opacity-45 hover:opacity-80",
              )}
              style={
                active
                  ? {
                      boxShadow: `0 0 0 2px ${entry.rarity.accent}, 0 0 16px -4px ${entry.rarity.accent}`,
                    }
                  : undefined
              }
            >
              {entry.frontUrl ? (
                <HoloCard
                  frontUrl={entry.frontUrl}
                  backUrl={null}
                  name={entry.name}
                  rarity={entry.rarity}
                  cacheKey={entry.id}
                  intensity="subtle"
                  interactive={false}
                />
              ) : (
                // HoloCard's own placeholder is typeset for a full-size card and
                // overflows a 64px chip. A card with no art is just a name here.
                <div
                  className="hud-bezel flex aspect-[5/7] w-full flex-col items-center justify-center gap-0.5 rounded-lg border p-1 text-center"
                  style={{ borderColor: entry.rarity.border }}
                >
                  <span className="font-display text-base font-black uppercase leading-none text-primary/70">
                    {initialsOf(entry.name) || "?"}
                  </span>
                  <span className="w-full truncate text-[7px] font-bold uppercase tracking-wider text-muted-foreground">
                    {entry.name}
                  </span>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
