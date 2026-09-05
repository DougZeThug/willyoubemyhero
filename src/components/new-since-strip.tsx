import { Link } from "@tanstack/react-router";
import { X } from "lucide-react";
import { HoloCard } from "@/components/holo-card";
import { LevelPips } from "@/components/level-pips";
import type { Edition } from "@/lib/card-edition";
import type { ImageUrlSet } from "@/lib/media";
import type { Rarity } from "@/lib/card-rarity";
import { cn } from "@/lib/utils";

/**
 * One card that arrived since the last visit.
 *
 * Shaped by the caller, like everything TodayCard renders: this component owns no
 * query and no store, so it can be drawn in a test from a bag of values and cannot
 * mount a second copy of the vault's data.
 *
 * `label` is the whole point of the tile and is deliberately a string rather than
 * a number: "NEW" and "×3" are the two things §12 asks for, and neither of them is
 * a denominator. The count behind a "×3" is computed by the vault from the
 * collection it already holds — it never crosses the wire from the server.
 */
export type NewSinceItem =
  | {
      kind: "roster";
      /** event_participants.id — what /players/$id is addressed by. */
      id: string;
      name: string;
      urls: ImageUrlSet | string | null;
      rarity: Rarity;
      edition: Edition;
      label: string;
    }
  | {
      kind: "secret";
      id: string;
      name: string;
      artUrl: string | null;
      rarity: Rarity;
      /** The level of your copy, for the pips. */
      tier: string;
      label: string;
    };

/**
 * What arrived since you last looked, as a row you can swipe.
 *
 * §12 asked for this and for what it must NOT be: no permanent badges on the
 * shelves below, no denominators, and gone the moment it has been acted on. So
 * there is no persistent state here — the strip is a function of one timestamp,
 * and tapping anything in it moves that timestamp.
 *
 * Deliberately narrow tiles. This lives at the bottom of a card the audit already
 * faults for its height (§3, §17), and a row of full-width cards would push the
 * binder off a 390px screen again — which is the thing PR 5 spent its whole budget
 * buying back.
 */
export function NewSinceStrip({
  items,
  onOpen,
  onDismiss,
  className,
}: {
  items: readonly NewSinceItem[];
  /** Fired before navigation, so the strip is marked seen either way. */
  onOpen: (item: NewSinceItem) => void;
  onDismiss: () => void;
  className?: string;
}) {
  if (items.length === 0) return null;

  return (
    <section aria-labelledby="new-since-heading" className={cn("mt-2", className)}>
      <div className="flex items-center justify-between gap-2">
        <h3
          id="new-since-heading"
          className="font-display text-label font-bold uppercase tracking-[0.08em] text-primary"
        >
          New since your last visit
        </h3>
        {/* 44px, like every other control PR 1 swept. Dismissing is the same
            write tapping a card makes, so somebody who has read the row and does
            not want to open anything is not stuck with it for a day. */}
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss what's new"
          className="-mr-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground"
        >
          <X aria-hidden className="h-4 w-4" />
        </button>
      </div>

      {/* snap-x so a thumb flick lands on a card rather than between two, and
          -mx-1/px-1 so the first and last tiles are not clipped by the panel's
          own padding. */}
      <ul
        className="-mx-1 flex snap-x snap-mandatory gap-2 overflow-x-auto px-1 pb-1"
        data-testid="new-since-strip"
      >
        {items.map((item) => (
          <li key={`${item.kind}:${item.id}`} className="w-20 shrink-0 snap-start">
            {item.kind === "roster" ? (
              <Link
                to="/players/$id"
                params={{ id: item.id }}
                onClick={() => onOpen(item)}
                className="group block focus:outline-none"
                aria-label={`${item.name} — ${item.label}`}
              >
                <Tile
                  label={item.label}
                  card={
                    <HoloCard
                      frontUrl={item.urls}
                      backUrl={null}
                      name={item.name}
                      rarity={item.rarity}
                      edition={item.edition}
                      intensity="subtle"
                      interactive={false}
                    />
                  }
                />
                <Caption name={item.name} />
              </Link>
            ) : (
              // A button and not a link, deliberately: a secret has no URL, which
              // is the one thing about it that must not change. See the header of
              // secret-card-sheet.tsx.
              <button
                type="button"
                onClick={() => onOpen(item)}
                className="group block w-full text-left focus:outline-none"
                aria-label={`${item.name} — ${item.label}`}
              >
                <Tile
                  label={item.label}
                  card={
                    <HoloCard
                      frontUrl={item.artUrl}
                      backUrl={null}
                      name={item.name}
                      rarity={item.rarity}
                      intensity="subtle"
                      interactive={false}
                    />
                  }
                />
                <Caption name={item.name} />
                <LevelPips tier={item.tier} className="mt-0.5 justify-center" />
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The card with its corner label. `aria-hidden` on the label — it is in the link's name. */
function Tile({ label, card }: { label: string; card: React.ReactNode }) {
  return (
    <div className="relative">
      {card}
      <span
        aria-hidden
        className="absolute -right-1 -top-1 rounded-full bg-primary px-1.5 py-0.5 text-badge font-black uppercase leading-none tracking-[0.06em] tabular-nums text-background"
      >
        {label}
      </span>
    </div>
  );
}

function Caption({ name }: { name: string }) {
  return (
    <div className="mt-1 truncate text-center font-display text-badge font-black uppercase tracking-wide text-foreground group-hover:text-primary">
      {name}
    </div>
  );
}
