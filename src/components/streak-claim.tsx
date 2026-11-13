import { Link } from "@tanstack/react-router";
import { offlineReason } from "@/hooks/use-online";
import type { StreakMilestoneStatus } from "@/lib/streaks.functions";

/**
 * The claim control for an earned streak rung: the button when this device can
 * claim, the way to an account when it cannot.
 *
 * Fragment on purpose — the strip and the pack summary wrap it differently.
 * Failures read as a line, never a toast: a toast announces the reward to whoever
 * is glancing at the phone over your shoulder.
 */
export function StreakClaim({
  claimable,
  canClaim,
  claiming,
  error,
  offline,
  onClaim,
  testId,
  next,
  waitingNote = "",
}: {
  claimable: StreakMilestoneStatus;
  canClaim: boolean;
  claiming: boolean;
  error: string | null;
  offline: boolean;
  onClaim?: () => void;
  testId: string;
  /** Where signing in lands, so the person comes back to the screen they left. */
  next: "/players" | "/players/pack";
  /** Said after "{label} is waiting." */
  waitingNote?: string;
}) {
  if (canClaim) {
    return (
      <>
        <button
          type="button"
          onClick={onClaim}
          disabled={claiming || offline}
          {...offlineReason(offline)}
          className="neon-btn-sm disabled:opacity-55"
          data-testid={testId}
        >
          {claiming ? "Opening…" : `Claim ${claimable.label}`}
        </button>
        {error && <span className="text-meta leading-snug text-muted-foreground">{error}</span>}
      </>
    );
  }
  return (
    <>
      <Link to="/auth" search={{ mode: "signup", next }} className="neon-btn-sm">
        Sign in to claim
      </Link>
      {/* Deliberately not "claim your player": thirteen people are on the roster
          and everyone else is here to watch. An account is something anybody can
          have, and it is what keeps the card. */}
      <span className="text-meta leading-snug text-muted-foreground">
        {claimable.label} is waiting.{waitingNote}
      </span>
    </>
  );
}
