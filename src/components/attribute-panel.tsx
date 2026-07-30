import {
  ATTRIBUTE_KEYS,
  ATTRIBUTE_META,
  RATING_FLOOR,
  RATING_CEIL,
  type PlayerAttributes,
} from "@/lib/card-attributes";

/**
 * The player's card ratings, at a size you can actually read.
 *
 * Same relationship to the card front that FieldComparison has to the card
 * back: the card prints these at trading-card size in whatever slot the layout
 * puts them, and this is the version with room for the label and the bar.
 *
 * Bars are drawn across the *rating scale*, not from zero — a 40 is the bottom
 * of the scale, so an empty bar is the honest picture of it. Drawing 40/99 of a
 * bar would make the floor look like a respectable showing.
 */
export function AttributePanel({ attributes }: { attributes: PlayerAttributes | null }) {
  if (!attributes) return null;
  const rated = ATTRIBUTE_KEYS.filter((k) => attributes.ratings[k] != null);
  if (rated.length === 0 && attributes.ovr == null) return null;

  return (
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted-foreground">
          Ratings
        </h2>
        <div className="flex items-baseline gap-2">
          {!attributes.settled && (
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
              Provisional
            </span>
          )}
          <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted-foreground">
            OVR
          </span>
          <span
            className="font-display text-2xl font-black leading-none tabular"
            style={{ color: "var(--tier)" }}
          >
            {attributes.ovr ?? "—"}
          </span>
        </div>
      </div>

      <ul className="space-y-2">
        {ATTRIBUTE_KEYS.map((key) => {
          const value = attributes.ratings[key];
          const meta = ATTRIBUTE_META[key];
          return (
            <li key={key} className="flex items-center gap-3">
              <span
                className="w-20 shrink-0 truncate text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
                title={meta.hint}
              >
                {meta.label}
              </span>
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-white/5">
                {value != null && (
                  <span
                    className="block h-full rounded-full transition-[width] duration-700 ease-out"
                    style={{
                      width: `${barPercent(value)}%`,
                      background: "color-mix(in oklab, var(--tier) 65%, transparent)",
                    }}
                  />
                )}
              </span>
              <span className="w-8 shrink-0 text-right text-[13px] font-bold tabular text-foreground/90">
                {value ?? "—"}
              </span>
            </li>
          );
        })}
      </ul>

      {!attributes.settled && (
        <p className="mt-3 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          Ratings compare you to the field, so they move until everyone has run.
        </p>
      )}
    </section>
  );
}

/**
 * Where a rating sits on its own scale, as a percentage.
 *
 * A floor value still draws a sliver rather than nothing at all, so the row
 * reads as "rated, at the bottom" instead of "no data" — which is what a truly
 * empty track means one row down.
 */
function barPercent(value: number): number {
  const span = RATING_CEIL - RATING_FLOOR;
  return Math.max(3, ((value - RATING_FLOOR) / span) * 100);
}

/**
 * The compact form, for the generated card back.
 *
 * Five chips on one line. No bars and no labels beyond the three-letter short
 * form: this renders at 8px on a face that spends half its life rotated away
 * from the viewer, and anything more would just be texture.
 */
export function AttributeChips({ attributes }: { attributes: PlayerAttributes | null }) {
  if (!attributes) return null;
  return (
    <div>
      {/* Provisional says the number is going to move, which on the day it will:
          these are field-relative, so somebody else running fast changes yours.
          Cheaper to say so once than to field the question thirteen times. */}
      {!attributes.settled && (
        <div className="mb-0.5 text-right text-[7px] font-bold uppercase tracking-[0.25em] text-muted-foreground">
          Provisional
        </div>
      )}
      <div className="grid grid-cols-5 gap-1">
        {ATTRIBUTE_KEYS.map((key) => (
          <div
            key={key}
            className="rounded border border-white/10 bg-white/[0.03] py-1 text-center"
            title={ATTRIBUTE_META[key].hint}
          >
            <div className="text-[7px] font-bold uppercase tracking-[0.15em] text-muted-foreground">
              {ATTRIBUTE_META[key].short}
            </div>
            <div className="font-display text-[13px] font-black leading-tight tabular text-foreground">
              {attributes.ratings[key] ?? "—"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
