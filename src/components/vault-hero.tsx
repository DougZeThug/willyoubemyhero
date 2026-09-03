import { Link } from "@tanstack/react-router";
import { ArrowLeftRight, Layers, PackageOpen, UserRoundCheck } from "lucide-react";
import { DustChip } from "@/components/dust-chip";
import { StreakFlame } from "@/components/streak-flame";
import { packsOpenedLabel } from "@/lib/card-pulls";
import { secretsPulledLabel, SECRET_RARITY } from "@/lib/secret-cards";
import { streakLine, type Streak } from "@/lib/streaks";
import { cn } from "@/lib/utils";

/**
 * The top of the vault, framed as a collection rather than a roster.
 *
 * Every number here is fetched by the page and arrives as a prop. That is what
 * keeps this a thing you can render in a test with a bag of values, and it is
 * also what stops a second copy of the collection queries mounting behind the
 * header of the screen that already holds them.
 *
 * The pills that used to sit on the right are gone: Awards lives behind the
 * League hub and Trade has a tab of its own, so both were the nav drawn twice.
 * What is left is the one control the daily loop turns on, given room.
 */
export function VaultHero({
  printed,
  rosterSize,
  ready,
  collectedCount,
  packsOpened,
  secretsPulled,
  dustOn,
  dustBalance,
  isMember,
  wasMember,
  syncError = null,
  streak,
  packWaiting,
  tradeUnread,
}: {
  printed: number;
  rosterSize: number;
  /** Whether the collection has reconciled. Every counter waits on it. */
  ready: boolean;
  collectedCount: number;
  packsOpened: number;
  secretsPulled: number;
  dustOn: boolean;
  dustBalance: number | undefined;
  isMember: boolean;
  wasMember: boolean;
  /**
   * Set when this device signed in but could not finish linking the account.
   * The message lived only on /auth, so anyone landing here from a deep link
   * saw an empty shelf and no reason for it.
   */
  syncError?: string | null;
  streak: Streak | null;
  packWaiting: boolean;
  tradeUnread: number;
}) {
  const streakSentence = streak ? streakLine(streak) : null;

  return (
    <div className="mb-5 border-b border-primary/20 pb-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-primary">
            <Layers className="h-5 w-5" />
            <span className="font-display text-label font-bold uppercase tracking-[0.08em]">
              Collection
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="font-display text-3xl font-black uppercase leading-none">The Vault</h1>
            {dustOn && <DustChip balance={dustBalance} to="/players/shop" />}
          </div>
          {/* The collected count waits for `ready`. It used to be read straight
              off IndexedDB, which had been inflated to the whole roster by the
              old collect-on-sight behaviour — rendering it early would show
              that number for a frame before it snapped down to the real one. */}
          <p className="mt-2 text-xs text-muted-foreground">
            {printed} of {rosterSize} cards printed
            {ready && collectedCount > 0 && ` · ${collectedCount} collected`}
          </p>
          {ready && packsOpenedLabel(packsOpened) && (
            <p className="mt-1 text-xs text-muted-foreground">{packsOpenedLabel(packsOpened)}</p>
          )}
          {/* Only ever rendered above zero. "0 secrets pulled" would announce
              that a set exists at all, which is the one thing withheld — and
              the caller's `?? 0` keeps a zero from flashing during the loading
              frame. */}
          {secretsPulled > 0 && (
            <p className="mt-1 text-xs font-bold" style={{ color: SECRET_RARITY.accent }}>
              {secretsPulledLabel(secretsPulled)}
            </p>
          )}
          {/* The daily loop's nudge, on the screen the app opens to rather than
              only on the pack. Same amber as the flame beside it, and silent at
              zero for the same reason as the secrets line above. */}
          {streakSentence && (
            <p className="mt-1 text-xs font-bold" style={{ color: "oklch(0.82 0.19 85)" }}>
              {streakSentence}
            </p>
          )}
          {!isMember && wasMember && (
            <p className="mt-2 max-w-xs text-[11px] leading-snug text-muted-foreground">
              Your secrets are on your name, not on this phone. Claim again to get them back.
            </p>
          )}
          {/* Same place and voice as the breadcrumb above: the shelf is empty
              for a reason, and the reason has an action. */}
          {syncError && (
            <p className="mt-2 max-w-xs text-[11px] leading-snug text-muted-foreground">
              {syncError}{" "}
              <Link to="/auth" className="font-bold text-primary hover:underline">
                Try again
              </Link>
            </p>
          )}
          {!isMember && (
            <Link
              to="/claim"
              className="mt-2 -ml-3 inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-label font-bold uppercase tracking-[0.08em] text-primary hover:underline"
            >
              <UserRoundCheck className="h-3.5 w-3.5" />
              Claim your player
            </Link>
          )}
        </div>
        <div className="flex items-center gap-3">
          {streak && <StreakFlame streak={streak} />}
          <div className="flex flex-col items-end gap-2">
            {/* The daily loop's alarm clock. Nothing else brings anyone back on
                a random Tuesday, so it is the biggest thing in the header now
                that the pills it shared the row with have gone to the nav.
                Leaks nothing: a guest, and a member who has already pulled
                today, both see the button exactly as it was. */}
            <Link
              to="/players/pack"
              className={cn("neon-btn-lg relative", packWaiting && "ring-2")}
              style={packWaiting ? { ["--tw-ring-color" as string]: SECRET_RARITY.border } : undefined} // prettier-ignore
              aria-label={packWaiting ? "Open today's pack — a secret is waiting" : "Open today's pack"} // prettier-ignore
            >
              <PackageOpen className="h-4 w-4" />
              Open Pack
              {packWaiting && (
                <span
                  aria-hidden
                  className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full"
                  style={{ background: SECRET_RARITY.border }}
                />
              )}
            </Link>
            {/* Only when there is something to answer. The Trade tab is always
                one tap away, so a permanent pill here would be the nav drawn
                twice — but an offer arrives while you are looking at this
                screen, and the tab's dot is easy to miss under a thumb. */}
            {tradeUnread > 0 && (
              <Link
                to="/players/trade"
                className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-primary/50 px-3 text-label font-bold uppercase tracking-[0.08em] text-primary"
              >
                <ArrowLeftRight className="h-3.5 w-3.5" />
                Offer waiting
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
