import { formatTime } from "@/lib/format";
import type { LadderRow } from "@/lib/card-stats";

/**
 * Station-by-station breakdown against the rest of the field.
 *
 * The same numbers appear on the generated card back, but there they render at
 * 8px on a face that is rotated away half the time. This is the readable
 * version: one row per station, a bar scaled to the slowest split, and the gap
 * to the field median called out in the tier colour when it's a gain.
 *
 * Bars are drawn relative to the *slowest* station rather than to the median,
 * so the shape of the row tells you where the course actually cost this player
 * time before you read a single number.
 */
export function FieldComparison({
  ladder,
  rank,
  fieldSize,
}: {
  ladder: LadderRow[];
  rank: number | null;
  fieldSize: number;
}) {
  const timed = ladder.filter((r) => r.ms != null);
  if (timed.length === 0) return null;

  const worst = Math.max(1, ...timed.map((r) => r.ms ?? 0));
  const gained = timed.filter((r) => (r.deltaMs ?? 0) < 0).length;
  const bestCount = timed.filter((r) => r.best).length;

  return (
    <section className="mt-8">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted-foreground">
          Vs. the field
        </h2>
        <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
          {rank != null && fieldSize > 0 && (
            <span style={{ color: "var(--tier)" }}>
              #{rank} of {fieldSize}
            </span>
          )}
          {rank != null && fieldSize > 0 && " · "}
          Faster than median at {gained}/{timed.length}
          {bestCount > 0 && (
            <>
              {" · "}
              <span style={{ color: "var(--tier)" }}>
                {bestCount} station{bestCount === 1 ? "" : "s"} won
              </span>
            </>
          )}
        </div>
      </div>

      {/* Said once here rather than on every row: the gap column was the part
          people could not read, and repeating the caption seven times is worse. */}
      <p className="mb-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
        Place at each station · gap vs. field median
      </p>

      <ul className="space-y-2.5">
        {ladder.map((row) => (
          <li key={row.id} className="flex items-center gap-2.5">
            <span className="w-16 shrink-0 truncate text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              {row.label}
            </span>
            <span className="hidden h-2 flex-1 overflow-hidden rounded-full bg-white/5 min-[380px]:block">
              {row.ms != null && (
                <span
                  className="block h-full rounded-full transition-[width] duration-700 ease-out"
                  style={{
                    width: `${Math.max(4, ((row.ms ?? 0) / worst) * 100)}%`,
                    // A station win reads in the tier colour at full strength;
                    // everything else is a muted version of the same hue, so the
                    // row still belongs to the card without shouting.
                    background: row.best
                      ? "var(--tier)"
                      : "color-mix(in oklab, var(--tier) 45%, transparent)",
                  }}
                />
              )}
            </span>
            {/* On a narrow phone the place tucks under the time instead of
                becoming a fourth column nobody can read. */}
            <span className="ml-auto flex shrink-0 flex-col items-end leading-tight min-[380px]:ml-0">
              <span className="text-[11px] tabular text-foreground/90">
                {row.ms != null ? formatTime(row.ms) : "—"}
              </span>
              {row.place != null && row.fieldCount > 0 && (
                <span
                  className={
                    "text-[9px] font-bold uppercase tracking-wider tabular " +
                    (row.place === 1 ? "" : "text-muted-foreground")
                  }
                  style={row.place === 1 ? { color: "var(--tier)" } : undefined}
                >
                  {ordinal(row.place)}/{row.fieldCount}
                </span>
              )}
            </span>
            <span
              className={
                "w-[4.75rem] shrink-0 text-right text-[10px] font-bold tabular leading-tight " +
                (row.deltaMs == null
                  ? "text-muted-foreground"
                  : row.deltaMs <= 0
                    ? "text-primary"
                    : "text-warn")
              }
            >
              {row.deltaMs == null ? (
                ""
              ) : (
                <>
                  {formatTime(Math.abs(row.deltaMs))}
                  <br />
                  <span className="font-semibold uppercase tracking-wider">
                    {row.deltaMs <= 0 ? "faster" : "slower"}
                  </span>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th. */
function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th";
  return `${n}${suffix}`;
}

