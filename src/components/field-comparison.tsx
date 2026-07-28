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
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
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

      <ul className="space-y-2">
        {ladder.map((row) => (
          <li key={row.id} className="flex items-center gap-3">
            <span className="w-20 shrink-0 truncate text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              {row.label}
            </span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-white/5">
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
            <span className="w-12 shrink-0 text-right text-[11px] tabular text-foreground/90">
              {row.ms != null ? formatTime(row.ms) : "—"}
            </span>
            <span
              className={
                "w-14 shrink-0 text-right text-[10px] font-bold tabular " +
                (row.deltaMs == null
                  ? "text-muted-foreground"
                  : row.deltaMs <= 0
                    ? "text-primary"
                    : "text-warn")
              }
            >
              {row.deltaMs == null
                ? ""
                : `${row.deltaMs <= 0 ? "▼" : "▲"}${formatTime(Math.abs(row.deltaMs))}`}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
