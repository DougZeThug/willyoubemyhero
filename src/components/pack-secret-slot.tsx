import { Link } from "@tanstack/react-router";
import { motion } from "motion/react";
import { Lock } from "lucide-react";
import { HoloCard } from "@/components/holo-card";
import { SealedBack } from "@/components/sealed-back";
import { SecretBackPanel } from "@/components/secret-back-panel";
import type { Rarity } from "@/lib/card-rarity";
import type { SecretCardView } from "@/lib/secret-cards";
import { cn } from "@/lib/utils";

/**
 * How the fourth slot is doing.
 *
 * Derived rather than kept as four booleans, two of which could be true at once.
 * The order matters: a pull that succeeds after a failure lands straight on
 * "sealed" rather than staying stuck on the error.
 */
export type SecretSlot = "hidden" | "gated" | "pending" | "failed" | "sealed" | "open";

/**
 * The fourth slot.
 *
 * Appended below the three, never a replaced slot: `nextPack` swaps its *last*
 * entry for a card the user has not collected, and that swap is the only
 * mechanism by which the thirteen-card set ever completes. It also keeps
 * PackState.ids at exactly three roster ids, which is what the e2e suite asserts.
 */
export function PackSecretSlot({
  slot,
  card,
  rarity,
  duplicate,
  peeking,
  pulledCount,
  hidden,
  registerSlot,
  onReveal,
  onRetry,
}: {
  slot: SecretSlot;
  card: SecretCardView | null;
  rarity: Rarity;
  duplicate: boolean;
  peeking: boolean;
  pulledCount: number;
  /** Up on the stage right now — the slot holds its size and nothing else. */
  hidden?: boolean;
  /** Ref callback, so the stage knows where to fly this card. */
  registerSlot?: (el: HTMLElement | null) => void;
  onReveal: () => void;
  onRetry: () => void;
}) {
  if (slot === "hidden") return null;

  return (
    // Wider than a board card, which is now ~173px on a phone. The fourth slot
    // has to stay visibly the biggest thing here or it stops reading as the thing
    // nobody else on the roster has.
    <div className="mx-auto flex w-full max-w-[240px] flex-col items-center gap-2 pt-2">
      <div className="text-center">
        <h2
          className="font-display text-sm font-black uppercase tracking-[0.2em]"
          style={{ color: rarity.accent }}
        >
          One More Card
        </h2>
        {slot === "gated" && (
          <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
            Claim your player to open it. Ask whoever&apos;s running the combine for your code.
          </p>
        )}
        {(slot === "sealed" || slot === "pending") && !peeking && (
          <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
            {slot === "pending"
              ? "Checking the wrapper…"
              : "Not on the roster. One a day, and it's yours for good."}
          </p>
        )}
        {peeking && (
          <p
            className="mt-1 text-[10px] font-bold uppercase tracking-[0.3em]"
            style={{ color: rarity.accent }}
          >
            Something else…
          </p>
        )}
      </div>

      {hidden ? (
        // Holds the slot's size while the card is up on the stage, so the board
        // does not shift out from under a card already in the air.
        <div
          ref={registerSlot}
          aria-hidden
          className="aspect-[5/7] w-full rounded-xl border border-dashed border-white/10"
        />
      ) : slot === "gated" ? (
        // Card-shaped, not a bordered link box — that reads as a cookie banner
        // and gets ignored.
        <Link
          to="/claim"
          className="wax-foil flex aspect-[5/7] w-full flex-col items-center justify-center gap-2 rounded-xl border border-white/15 p-4 text-center"
        >
          <Lock className="h-6 w-6 text-muted-foreground" />
          <span className="font-display text-[10px] font-black uppercase tracking-[0.25em] text-primary">
            Claim your player
          </span>
        </Link>
      ) : slot === "failed" ? (
        <button
          onClick={onRetry}
          className="wax-foil flex aspect-[5/7] w-full flex-col items-center justify-center gap-2 rounded-xl border border-white/15 p-4 text-center opacity-60"
        >
          <span className="font-display text-xs font-black uppercase tracking-[0.2em]">
            No signal
          </span>
          {/* Never a toast: a toast announces a fourth card to whoever is
              glancing at the phone over your shoulder. */}
          <span className="text-[10px] leading-snug text-muted-foreground">
            Tap to try again — you haven&apos;t used today&apos;s.
          </span>
        </button>
      ) : slot === "pending" ? (
        <div className="wax-foil flex aspect-[5/7] w-full animate-pulse items-center justify-center rounded-xl border border-white/15" />
      ) : slot === "sealed" && card ? (
        <div
          ref={registerSlot}
          // w-full is load-bearing: the column above centres its items, which
          // makes a flex child shrink to its content, and HoloCard sizes itself
          // from its width via aspect-ratio — so without this the card collapses
          // to nothing and the slot renders as a sliver.
          className={cn("relative w-full rounded-xl transition-shadow", peeking && "animate-pulse")}
          style={
            peeking
              ? {
                  // Deliberately thinner than the hit's 6px inset, so it reads as
                  // a different thing rather than as a bigger one.
                  boxShadow: `inset 0 0 0 8px ${rarity.border}, 0 0 70px ${rarity.border}`,
                }
              : { boxShadow: `inset 0 0 0 3px ${rarity.border}, 0 0 20px ${rarity.border}` }
          }
        >
          <motion.div
            animate={peeking ? { scale: 1.06 } : { scale: 1 }}
            transition={{ duration: 0.9 }}
          >
            <HoloCard
              frontUrl={null}
              backUrl={null}
              name="Secret"
              rarity={rarity}
              cacheKey={`secret-sealed-${card.id}`}
              faceDown
              flipped={false}
              interactive={false}
              backContent={<SealedBack />}
              onClick={onReveal}
            />
          </motion.div>
        </div>
      ) : card ? (
        <>
          <div
            ref={registerSlot}
            className={cn("relative w-full rounded-xl", duplicate && "secret-dupe-shimmer")}
          >
            <HoloCard
              frontUrl={card.artUrl}
              backUrl={card.backUrl}
              name={card.name}
              rarity={rarity}
              cacheKey={card.id}
              tilt="hero"
              backContent={<SecretBackPanel card={card} rarity={rarity} />}
            />
          </div>
          <div className="text-center">
            <div className="truncate font-display text-xs font-black uppercase tracking-wide">
              {card.name}
            </div>
            {duplicate ? (
              <div className="text-[9px] font-bold uppercase tracking-[0.25em] text-muted-foreground">
                Already yours — you&apos;ve pulled the whole set. This one&apos;s just showing off.
              </div>
            ) : (
              <div
                className="text-[9px] font-bold uppercase tracking-[0.25em]"
                style={{ color: rarity.border }}
              >
                {/* Taught once, on the first secret anyone ever pulls. Without it
                    the empty vault shelf afterwards reads as a bug. */}
                {pulledCount <= 1
                  ? "Secret · Not on the roster. Nobody knows how many there are."
                  : "Secret · Yours for good, even on a new phone."}
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
