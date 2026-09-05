import { Link } from "@tanstack/react-router";
import { ArrowLeftRight, PackageOpen } from "lucide-react";
import { NewSinceStrip, type NewSinceItem } from "@/components/new-since-strip";
import { StreakFlame } from "@/components/streak-flame";
import { offlineReason } from "@/hooks/use-online";
import { nextPackLabel } from "@/lib/pack";
import { SECRET_RARITY } from "@/lib/secret-cards";
import { nextMilestoneLine, streakLine, STREAK_MILESTONES } from "@/lib/streaks";
import type { StreakStatus, StreakMilestoneStatus } from "@/lib/streaks.functions";
import { cn } from "@/lib/utils";

/**
 * The amber the whole streak feature is drawn in — the only warm colour in a
 * palette built out of cyan. The literal is shared with streak-flame.tsx,
 * milestone-reveal.tsx and pack-summary.tsx; it is repeated rather than imported
 * because each of those needs it as an inline style, not a class.
 */
const AMBER = "oklch(0.82 0.19 85)";

/** Stable identity, so a defaulted prop cannot re-render the strip every paint. */
const EMPTY_NEW: readonly NewSinceItem[] = [];

/** Today's pack, as the vault sees it. `left` only means anything while torn. */
export type TodayCardPack = {
  state: "loading" | "sealed" | "torn" | "done";
  left: number;
};

/**
 * What to do right now, in one card.
 *
 * The screen the app opens to used to answer this weakly and expensively: the
 * pack was a button whose label never changed, `resetsAt` was fetched on every
 * load and rendered nowhere, and a reward earned yesterday sat two taps away
 * behind Pack → summary (§3, §11). This is those three answers in the space the
 * counter stack used to take.
 *
 * EVERY NUMBER ARRIVES AS A PROP, like VaultHero next door and for the same two
 * reasons: it can be rendered in a test with a bag of values, and it cannot
 * mount a second copy of the queries the page above it already holds.
 *
 * FIXED HEIGHT is the other half of the brief, and the min-heights below are how
 * it is kept. This card settles through five independent query results — pack
 * state off IndexedDB, the secret's status, the streak, the milestone ladder,
 * trade offers — and each one landing used to push the shelves down under a
 * thumb that was already reaching for a card. An empty slot costs 16–44px; a
 * grid that jumps costs a mistap.
 */
export function TodayCard({
  pack,
  packWaiting,
  nextPackAt,
  now,
  streak,
  streakPending = false,
  claimable = null,
  canClaim = false,
  claiming = false,
  claimError = null,
  offline = false,
  onClaim,
  tradeUnread = 0,
  newCards = EMPTY_NEW,
  onOpenNewCard,
  onDismissNew,
}: {
  pack: TodayCardPack;
  /** A secret is waiting. Members-only in practice — see `secretWaiting`. */
  packWaiting: boolean;
  /**
   * When the next pack lands, as an ISO instant, or null when nobody knows.
   *
   * TWO CLOCKS, and this is the seam between them. `SecretDayStatus.resetsAt` is
   * the league's midnight in America/New_York, because that is what the secret
   * drop rolls over on; the pack itself re-seals on the DEVICE's local midnight
   * (`todayKey`). For anybody outside that zone the two differ, so this
   * countdown is an approximation of the pack by way of the secret — which is
   * the trade the audit asked for, since `resetsAt` is the only one of the two
   * the server actually vouches for.
   */
  nextPackAt: string | null;
  /** The pack poll's clock, so the countdown re-renders with the day tick. */
  now: number;
  streak: StreakStatus | null;
  /**
   * Whether a streak answer is still coming.
   *
   * The strip's slot is reserved while it is true and gone once the answer is
   * known to be zero. Reserving it forever would spend the height on somebody
   * who has never opened a pack, on a screen the audit already faults for its
   * height; never reserving it would drop the shelves by that much the moment
   * the query lands, which is the shift the min-heights exist to remove.
   *
   * The reservation is TWO ROWS, because that is what the strip measures at
   * phone widths: the flame, the day and the five rungs fill a line on their
   * own, and the promise sits under them. A claimable rung adds a third — but it
   * arrives in the same response as the streak itself, so that is one settle and
   * not a second one.
   */
  streakPending?: boolean;
  claimable?: StreakMilestoneStatus | null;
  canClaim?: boolean;
  claiming?: boolean;
  claimError?: string | null;
  offline?: boolean;
  onClaim?: () => void;
  tradeUnread?: number;
  /**
   * What arrived since this device last looked (§12), already shaped for drawing.
   *
   * A prop like every other number here, and for the third reason as well as the
   * usual two: what makes a card "×3" is the collection the vault has already
   * reconciled, and this card must not be the second place that decides it.
   */
  newCards?: readonly NewSinceItem[];
  onOpenNewCard?: (item: NewSinceItem) => void;
  onDismissNew?: () => void;
}) {
  const running = !!streak && streak.current > 0;
  // Alive but not yet extended today. `walkStreak` anchors on today or yesterday
  // and returns a dead run otherwise, so `current > 0` IS alive and `openedToday`
  // is the whole at-risk question.
  const atRisk = running && !streak.openedToday;

  return (
    <section
      aria-labelledby="today-heading"
      className="surface-panel mb-3 rounded-xl border p-3"
      data-testid="today-card"
    >
      <h2
        id="today-heading"
        className="font-display text-label font-bold uppercase tracking-[0.08em] text-muted-foreground"
      >
        Today
      </h2>

      {/* The primary slot. One height across all four states, which is what stops
          the shelves moving when IndexedDB finally answers.

          The offer pill shares this row rather than taking a band of its own,
          and that is the difference between reserving space and leaving a hole:
          a slot nobody has an offer in is empty on almost every load, and 44px
          of nothing between the button and the streak is what pushed the first
          card off a 320px screen. Beside the button it costs nothing when it is
          absent and still cannot move anything when it lands. */}
      <div className="mt-2 flex min-h-14 flex-wrap items-center justify-between gap-2">
        {pack.state === "loading" ? (
          // Not "sealed" while we do not know. Painting "Open today's pack" over
          // a pack somebody is halfway through, then swapping the label under
          // their thumb, is the failure the pack screen's own `stateLoaded`
          // guard exists for.
          <p role="status" className="sr-only">
            Checking today's pack…
          </p>
        ) : pack.state === "done" ? (
          // Deliberately not a link. The Pack tab is always one tap away, so a
          // second route to the same screen here would be the nav drawn twice —
          // the argument that took the Awards and Trade pills off this header in
          // the first place.
          <p className="inline-flex min-h-14 items-center gap-2 rounded-full border border-primary/25 px-5 font-display text-button font-extrabold uppercase tracking-[0.08em] text-muted-foreground">
            <PackageOpen aria-hidden className="h-4 w-4" />
            {nextPackLabel(nextPackAt, now)}
          </p>
        ) : (
          <Link
            to="/players/pack"
            className={cn("neon-btn-lg relative", packWaiting && "ring-2")}
            style={packWaiting ? { ["--tw-ring-color" as string]: SECRET_RARITY.border } : undefined} // prettier-ignore
            // Byte-identical to what this control has always said when sealed:
            // the e2e suite matches these exactly, and so does anyone who has
            // learned the screen by its shape.
            aria-label={
              pack.state === "torn"
                ? finishLabel(pack.left)
                : packWaiting
                  ? "Open today's pack — a secret is waiting"
                  : "Open today's pack"
            }
          >
            <PackageOpen aria-hidden className="h-4 w-4" />
            {pack.state === "torn" ? finishLabel(pack.left) : "Open Pack"}
            {packWaiting && (
              <span
                aria-hidden
                className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full"
                style={{ background: SECRET_RARITY.border }}
              />
            )}
          </Link>
        )}

        {/* Only when there is something to answer. The Trade tab carries the
            same news permanently, but its dot is easy to miss under a thumb on
            the screen you are already looking at. */}
        {tradeUnread > 0 && (
          <Link
            to="/players/trade"
            // The words drop below sm, the same treatment the sort chips used to
            // take, and here it is what makes the claim above TRUE. In the done
            // state the pack pill is ~200px; a 130px pill beside it exceeds the
            // ~294px a 320px screen has to give and wraps to a second line —
            // moving the streak down by 56px, which is exactly the shift this
            // card exists to prevent. Icon-only it is 44px and always fits.
            aria-label="Offer waiting — open the Trading Post"
            className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-full border border-primary/50 px-3 text-label font-bold uppercase tracking-[0.08em] text-primary"
          >
            <ArrowLeftRight aria-hidden className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Offer waiting</span>
          </Link>
        )}
      </div>

      {/* The done state's second line, and the only place the old streak sentence
          survives — it is the reason to come back tomorrow, said on the day you
          have already been. */}
      <div className="mt-1 min-h-4 text-xs font-bold" style={{ color: AMBER }}>
        {pack.state === "done" && streak ? streakLine(streak) : null}
      </div>

      {(running || streakPending) && (
        <div className="mt-1 min-h-16" data-testid="streak-slot">
          {running && (
            <StreakStrip
              streak={streak}
              atRisk={atRisk}
              claimable={claimable}
              canClaim={canClaim}
              claiming={claiming}
              claimError={claimError}
              offline={offline}
              onClaim={onClaim}
            />
          )}
        </div>
      )}

      {/* THE ONE SLOT THIS CARD DOES NOT RESERVE, which is a deliberate exception
          to everything above rather than an oversight. A strip of cards measures
          ~180px with its heading and its dismiss control — more than the whole
          header PR 5 bought back — and it is empty on almost every load. Holding
          that height open permanently, or even only while the query is in flight,
          costs it on every visit to save one shift on the minority that have news.
          So it is rendered only when there is something, and it is LAST, below
          every control on the card, so the shift it does cause is never under a
          thumb that is already reaching for one. */}
      {newCards.length > 0 && (
        <NewSinceStrip
          items={newCards}
          onOpen={(item) => onOpenNewCard?.(item)}
          onDismiss={() => onDismissNew?.()}
        />
      )}
    </section>
  );
}

/** "Finish your pack · 2 cards left". Singular at one, like every count here. */
function finishLabel(left: number): string {
  return `Finish your pack · ${left} ${left === 1 ? "card" : "cards"} left`;
}

/**
 * The ladder, made visible.
 *
 * Its absence was the biggest single gap in the streak feature (§11): a person
 * learned a rung existed by landing on it. Five markers and one promise say the
 * whole shape in the height of one control, without a progress bar — the run is
 * not a percentage of anything, it is a set of doors.
 */
function StreakStrip({
  streak,
  atRisk,
  claimable,
  canClaim,
  claiming,
  claimError,
  offline,
  onClaim,
}: {
  streak: StreakStatus;
  atRisk: boolean;
  claimable: StreakMilestoneStatus | null;
  canClaim: boolean;
  claiming: boolean;
  claimError: string | null;
  offline: boolean;
  onClaim?: () => void;
}) {
  // `earned` off the server where there is one, so the rungs agree with the
  // button beside them; the bare comparison is the fallback for a status that
  // shipped without the ladder attached.
  const earned = (days: number) =>
    streak.milestones.find((m) => m.days === days)?.earned ?? streak.current >= days;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-2 py-1",
        // The at-risk state, as a colour and not only as a sentence. A run that
        // ended yesterday is alive and one missed evening from gone, and until
        // now the only thing that said so was a flame that stopped pulsing.
        atRisk && "border",
      )}
      style={atRisk ? { borderColor: `color-mix(in oklab, ${AMBER} 55%, transparent)` } : undefined}
    >
      <StreakFlame streak={streak} compact className="shrink-0" />
      <span
        className="font-display text-badge font-black uppercase tracking-[0.08em]"
        style={{ color: AMBER }}
      >
        {" "}
        {/* prettier-ignore */}
        Day {streak.current}
      </span>

      <ol className="flex shrink-0 items-center gap-1" aria-label="Streak rewards">
        {STREAK_MILESTONES.map((m) => {
          const done = earned(m.days);
          return (
            <li
              key={m.days}
              className={cn(
                "flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-meta font-bold tabular-nums",
                done ? "text-background" : "border text-muted-foreground",
              )}
              style={
                done
                  ? { background: AMBER }
                  : { borderColor: `color-mix(in oklab, ${AMBER} 35%, transparent)` }
              }
            >
              {m.days}
              <span className="sr-only">{done ? " days, reached" : " days, still to go"}</span>
            </li>
          );
        })}
      </ol>

      {claimable ? (
        canClaim ? (
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onClaim}
              disabled={claiming || offline}
              {...offlineReason(offline)}
              className="neon-btn-sm disabled:opacity-50"
              data-testid="today-streak-claim"
            >
              {claiming ? "Opening…" : `Claim ${claimable.label}`}
            </button>
            {/* Never a toast, for the same reason the pack summary avoids one: it
                announces the reward to whoever is glancing at the phone over
                your shoulder. */}
            {claimError && (
              <span className="text-meta leading-snug text-muted-foreground">{claimError}</span>
            )}
          </span>
        ) : (
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <Link to="/auth" search={{ mode: "signup", next: "/players" }} className="neon-btn-sm">
              Sign in to claim
            </Link>
            {/* Deliberately not "claim your player": thirteen people are on the
                roster and everyone else is here to watch. An account is
                something anybody can have, and it is what keeps the card. */}
            <span className="text-meta leading-snug text-muted-foreground">
              {claimable.label} is waiting.
            </span>
          </span>
        )
      ) : (
        <span className="min-w-0 text-meta leading-snug text-muted-foreground">
          {atRisk ? "Keep it alive" : nextMilestoneLine(streak)}
        </span>
      )}
    </div>
  );
}
