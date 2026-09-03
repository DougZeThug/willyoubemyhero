import { StatTile } from "@/components/stat-tile";
import { packsOpenedLabel } from "@/lib/card-pulls";
import type { Rarity } from "@/lib/card-rarity";

/**
 * Your own pack history, at the bottom of your own card.
 *
 * Only ever rendered on the card of the member looking at it. A pack count leaks
 * nothing about *which* cards somebody holds, so it could safely be public — but
 * the per-member rows behind it are deliberately private (see card_pulls), and a
 * section that showed your numbers on someone else's card would be confusing
 * before it was interesting.
 *
 * The denominator comes from the roster the page already has, never from the
 * server: no response in this app carries a total, which is what keeps the secret
 * set's size protected by construction. See the header of lib/card-pulls.ts.
 */
export function PackStats({
  packsOpened,
  collectedCount,
  rosterSize,
  dupes,
  firstPackOn,
  best,
}: {
  packsOpened: number;
  collectedCount: number;
  rosterSize: number;
  dupes: number;
  /** League day of your first pack, `YYYY-MM-DD`. */
  firstPackOn: string | null;
  /** The rarest card you hold, or null if you hold none. */
  best: Rarity | null;
}) {
  // A member who has never ripped a pack gets nothing rather than a row of
  // zeroes — the same reasoning as the secrets line on the vault.
  if (packsOpened === 0 && collectedCount === 0) return null;

  const since = formatDay(firstPackOn);

  return (
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-label font-bold uppercase tracking-[0.08em] text-muted-foreground">
          Your pack stats
        </h2>
        <div className="text-meta font-semibold text-muted-foreground">
          {packsOpenedLabel(packsOpened) ?? "No packs yet"}
          {since && ` · since ${since}`}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Packs" value={String(packsOpened)} />
        <StatTile label="Collected" value={`${collectedCount}/${rosterSize}`} />
        <StatTile label="Dupes" value={String(dupes)} />
        <StatTile label="Best pull" value={best?.label ?? "—"} />
      </div>

      <p className="mt-2 text-meta text-muted-foreground">
        One pack a day. Only cards you have actually pulled count here.
      </p>
    </section>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * `YYYY-MM-DD` → `31 Jul`.
 *
 * Split by hand rather than through `Date`: the value is already a league day, and
 * parsing it would drag it through the viewer's timezone and land a late-evening
 * pack on the wrong date.
 */
function formatDay(day: string | null): string | null {
  if (!day) return null;
  const [, month, date] = day.split("-");
  const name = MONTHS[Number(month) - 1];
  if (!name || !date) return null;
  return `${Number(date)} ${name}`;
}
