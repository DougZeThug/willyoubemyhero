import { Link } from "@tanstack/react-router";
import { LevelPips } from "@/components/level-pips";
import { StreakFlame } from "@/components/streak-flame";
import { formatDay } from "@/lib/format";
import { secretTierStyle } from "@/lib/secret-rarity";
import { STREAK_MILESTONES, nextMilestoneLine, streakLine } from "@/lib/streaks";
import type { StreakHistoryEntry, StreakStatus } from "@/lib/streaks.functions";
import { cn } from "@/lib/utils";

/** The streak's own colour, as the Today card and the flame use it. */
const AMBER = "oklch(0.82 0.19 85)";

/**
 * The whole ladder, and what it has paid.
 *
 * The Today card's strip says the same rungs in the height of one control,
 * because home has one job and it is not teaching. This is the long form: what
 * each rung is worth, which ones are behind you, and the cards the ones behind
 * you handed over. §11 asked for both and the strip was only half of it.
 *
 * Deliberately READ-ONLY. Claiming lives on the Today card and on the pack
 * summary — the two screens where the run was actually extended — and a third
 * button here would be a third place for a once-a-run action to half-happen. A
 * claimable rung gets a line pointing home instead.
 */
export function StreakLadder({
  streak,
  history,
  historyLoading = false,
}: {
  streak: StreakStatus | undefined;
  history: readonly StreakHistoryEntry[];
  historyLoading?: boolean;
}) {
  // Nothing at zero, on the same rule the flame and the pack summary keep: a
  // ladder shown to somebody who has never opened a pack is a list of things
  // they have not done.
  if (!streak || streak.current <= 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Open a pack to start a streak. Three days in a row pays a bonus secret.
      </p>
    );
  }

  const claimable = streak.milestones.find((m) => m.earned && !m.claimed) ?? null;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <StreakFlame streak={streak} compact className="shrink-0" />
        <span
          className="font-display text-badge font-black uppercase tracking-[0.08em]"
          style={{ color: AMBER }}
        >
          Day {streak.current}
        </span>
        <span className="text-sm text-muted-foreground">{streakLine(streak)}</span>
      </div>

      <ol className="mt-3 space-y-1">
        {STREAK_MILESTONES.map((m) => {
          const status = streak.milestones.find((s) => s.days === m.days);
          const earned = status?.earned ?? streak.current >= m.days;
          const claimed = status?.claimed ?? false;
          return (
            <li
              key={m.days}
              className="flex min-h-11 items-center gap-3 rounded-lg px-2 py-1.5"
              style={
                earned
                  ? { background: `color-mix(in oklab, ${AMBER} 12%, transparent)` }
                  : undefined
              }
            >
              <span
                aria-hidden
                className={cn(
                  "flex h-7 min-w-7 shrink-0 items-center justify-center rounded-full px-1 text-meta font-bold tabular-nums",
                  earned ? "text-background" : "border text-muted-foreground",
                )}
                style={
                  earned
                    ? { background: AMBER }
                    : { borderColor: `color-mix(in oklab, ${AMBER} 35%, transparent)` }
                }
              >
                {m.days}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-display text-badge font-bold uppercase tracking-[0.08em]">
                  {m.label}
                </span>
                <span className="block text-meta text-muted-foreground">{m.blurb}</span>
              </span>
              {/* The state in words, never the colour alone. "Claimed" beats
                  "reached" where both are true: it is the later fact. */}
              <span className="shrink-0 text-meta text-muted-foreground">
                {claimed ? "Claimed" : earned ? "Waiting" : `${m.days} days`}
                <span className="sr-only">
                  {claimed
                    ? ` — ${m.label} claimed`
                    : earned
                      ? ` — ${m.label} reached and not yet claimed`
                      : ` — ${m.label} still to go`}
                </span>
              </span>
            </li>
          );
        })}
      </ol>

      {claimable ? (
        <div className="mt-2">
          <p className="text-sm text-muted-foreground">{claimable.label} is waiting.</p>
          {/* A button rather than a word in the sentence: it is a thing to tap,
              and an inline link is a 20px target on the one screen whose whole
              point is that a setting can be found and used. */}
          <Link to="/players" className="neon-btn-sm mt-2 inline-flex">
            Claim it on the vault
          </Link>
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">{nextMilestoneLine(streak)}</p>
      )}

      <StreakHistory entries={history} loading={historyLoading} />
    </div>
  );
}

/**
 * What the rungs actually paid.
 *
 * Every run, not just this one — the whole point is that a streak you broke in
 * July still handed you a card, and `getStreakStatus` cannot say so because its
 * flags reset with the run.
 *
 * Rendered as names and level pips rather than cards: the cards live in the
 * vault, and a shelf of them here would be a second collection screen.
 */
function StreakHistory({
  entries,
  loading,
}: {
  entries: readonly StreakHistoryEntry[];
  loading: boolean;
}) {
  if (loading) {
    return <p className="mt-4 text-meta text-muted-foreground">Reading your rewards…</p>;
  }
  if (entries.length === 0) return null;

  return (
    <div className="mt-4">
      <h3 className="font-display text-badge font-bold uppercase tracking-[0.08em] text-primary">
        What you claimed
      </h3>
      <ul className="mt-2 space-y-1">
        {entries.map((e) => (
          <li
            key={`${e.streakStartedOn}-${e.milestone}`}
            className="flex min-h-11 items-center gap-3 border-b border-white/5 py-1.5 last:border-0"
          >
            <span className="w-20 shrink-0 text-meta text-muted-foreground">
              {formatDay(e.claimedOn)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">
                {/* A rung the commissioner has since retired still has a number,
                    which is the one thing about it that was ever persisted. */}
                {e.label ?? `${e.milestone} days`}
              </span>
              {e.card && (
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-meta text-muted-foreground">{e.card.name}</span>
                  <LevelPips tier={e.card.tier} />
                  <span
                    className="text-meta"
                    style={{ color: secretTierStyle(e.card.tier).accent }}
                  >
                    {secretTierStyle(e.card.tier).label}
                  </span>
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
