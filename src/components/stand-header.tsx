import type { PackOutcome } from "@/lib/pack-outcome";
import { cn } from "@/lib/utils";

/**
 * The step counter and the one line under it that says what the card wants.
 *
 * Purely a reading of the stand's state: it owns nothing, and the e2e suite
 * reads both of its elements by test id.
 */
export function StandHeader({
  heading,
  accent,
  peeking,
  onSecret,
  isRevealed,
  tapRefused,
  outcome,
}: {
  heading: string;
  /** The card's own colour, which the heading and the peek line borrow for a secret. */
  accent: string;
  peeking: boolean;
  onSecret: boolean;
  isRevealed: boolean;
  tapRefused: boolean;
  outcome: PackOutcome;
}) {
  return (
    <div className="text-center">
      {/* Carries a test id because the e2e suite reads it to know the stand
          has the screen and which step it is on. It used to match the prose
          ("Card 1 of 3") out of the whole document body, which made a copy
          change a five-spec failure with no obvious cause. */}
      <div
        data-testid="stand-step"
        className={cn(
          "font-display text-label font-black uppercase tracking-[0.08em]",
          !onSecret && "text-muted-foreground/70",
        )}
        style={{ color: onSecret ? accent : undefined }}
      >
        {heading}
      </div>
      {/* Kept in the tree at every step — it is what a screen reader and the
          e2e suite both read to know what the card wants — but dimmed to the
          edge of legibility once there is a card to look at instead. */}
      <p className="mt-1 h-5 text-meta leading-snug text-muted-foreground/70">
        {peeking
          ? ""
          : onSecret
            ? isRevealed
              ? "Swipe for the next card · tap for the back"
              : "Not on the roster. Yours for good."
            : isRevealed
              ? "Swipe for the next card · tap for the back"
              : // Only the invitation goes quiet when the tap would be
                // refused. The secret's line above is a statement about the
                // card, not an offer, so it has nothing to take back.
                tapRefused
                ? ""
                : "Tap the card to turn it"}
      </p>
      {peeking && (
        <p
          className="mt-1 text-label font-bold uppercase tracking-[0.08em]"
          style={{ color: accent }}
        >
          {/* The hold is only ever spent on a card worth it — see peekMs —
              so the line under it can say why. */}
          {onSecret
            ? "Something else…"
            : outcome === "upgrade"
              ? "Better than yours…"
              : "New card…"}
        </p>
      )}
    </div>
  );
}
