import { Link } from "@tanstack/react-router";
import { Layers, UserRoundCheck } from "lucide-react";
import { DustChip } from "@/components/dust-chip";

/**
 * The top of the vault: what this screen is, and who is holding it.
 *
 * It used to be the whole header — a stack of four counters, the streak
 * sentence, the flame, the pack button and the offer pill — and that stack was
 * most of the ~640px the audit measured before the first card at 390 (§3, §17).
 * Everything that answers "what should I do right now" has gone next door to
 * TodayCard, and everything that counts the collection has become the one
 * summary line under it (§13). What is left is identity: the name of the screen,
 * the dust you can spend on it, and the three things that only matter to
 * somebody who has not finished signing in.
 *
 * "Cards printed" went with them and did not come back. It is an admin concept —
 * cards that have art — and it read as a collector's number beside "3 collected".
 * The count is still fetched; it belongs in admin and, later, the profile.
 *
 * Every value here still arrives as a prop. That is what keeps this a thing you
 * can render in a test with a bag of values, and it is also what stops a second
 * copy of the collection queries mounting behind the header of the screen that
 * already holds them.
 */
export function VaultHero({
  dustOn,
  dustBalance,
  isMember,
  wasMember,
  syncError = null,
}: {
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
}) {
  return (
    <div className="mb-3">
      <div className="flex items-center gap-2 text-primary">
        <Layers aria-hidden className="h-5 w-5" />
        <span className="font-display text-label font-bold uppercase tracking-[0.08em]">
          Collection
        </span>
      </div>
      {/* The chip needs its own BOX and not just a taller row, which is the one
          slot here where a min-height is not enough. DustChip renders nothing
          until the balance is known — a "0" that becomes "140" reads as having
          just lost something — and this row wraps, so at a width where the chip
          does not fit beside the heading the row goes from one line to two the
          moment the number lands, and a min-height that reserved the unwrapped
          case would let the shelf move anyway.

          8rem covers a THREE-DIGIT balance and no more, which is what the
          measurements support and all this claims. Rendered, the chip is 126px at
          three digits, 143 at four and 153 at five, against a 179px heading and a
          row of 288–344px. So a balance in the hundreds — the ordinary one, when
          a bonus pull costs 150 — reserves exactly right and the row never moves.
          Four digits or more still flips it once, at 360–390, when the number
          lands. */}
      <div className="mt-1 flex min-h-11 flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="font-display text-3xl font-black uppercase leading-none">The Vault</h1>
        {dustOn && (
          <div className="flex min-h-11 min-w-32 items-center">
            <DustChip balance={dustBalance} to="/players/shop" />
          </div>
        )}
      </div>
      {!isMember && wasMember && (
        <p className="mt-2 max-w-xs text-[11px] leading-snug text-muted-foreground">
          Your secrets are on your name, not on this phone. Claim again to get them back.
        </p>
      )}
      {/* Same place and voice as the breadcrumb above: the shelf is empty for a
          reason, and the reason has an action. */}
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
          className="mt-1 -ml-3 inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-label font-bold uppercase tracking-[0.08em] text-primary hover:underline"
        >
          <UserRoundCheck aria-hidden className="h-3.5 w-3.5" />
          Claim your player
        </Link>
      )}
    </div>
  );
}
