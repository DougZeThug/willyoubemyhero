import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { mySecretsKey, secretStatusKey } from "@/hooks/use-daily-secret";
import { streakStatusKey } from "@/hooks/use-streak";
import { claimStreakMilestone, type StreakMilestoneStatus } from "@/lib/streaks.functions";
import type { StreakStatus } from "@/lib/streaks.functions";
import { streakMilestone } from "@/lib/streaks";
import type { SecretCardView } from "@/lib/secret-cards";
import type { SecretTier } from "@/lib/secret-rarity";

/** What MilestoneReveal needs to play the ceremony, once a claim has landed. */
export type MilestoneRevealState = {
  milestone: number;
  streak: number;
  card: SecretCardView;
  tierFloor: SecretTier | null;
  duplicate: boolean;
};

/**
 * Cashing a streak milestone, from wherever the person is standing.
 *
 * Lifted out of players.pack.tsx unchanged, because the reward is now claimable
 * from two screens and two copies of this would be two ladders — one of which
 * would quietly start paying twice. Every rule below was already load-bearing
 * there:
 *
 * A button rather than an auto-grant on the pack open, because the reward is a
 * card and a card needs a reveal to be worth anything — and because the claim
 * table's uniqueness makes a retry free, so a tap that lost its response costs
 * nothing.
 *
 * Two latches, doing different jobs. `claimingRef` stops a double tap racing
 * itself to the same milestone; `claimedRef` stops a milestone that already
 * showed its reveal from showing it again when the query refetches on focus.
 */
export function useMilestoneClaim(actor: string | null, streak: StreakStatus | null) {
  const qc = useQueryClient();
  const claimFn = useServerFn(claimStreakMilestone);
  const claimingRef = useRef(false);
  const claimedRef = useRef(new Set<number>());
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [milestoneReveal, setMilestoneReveal] = useState<MilestoneRevealState | null>(null);

  // A phone changing hands mid-party is a real thing in this league. The next
  // person's milestones are their own, and a reveal left on screen would be
  // showing them somebody else's card.
  useEffect(() => {
    claimedRef.current = new Set();
    claimingRef.current = false;
    setClaiming(false);
    setClaimError(null);
    setMilestoneReveal(null);
  }, [actor]);

  // The highest rung earned and not yet taken. Highest rather than lowest so a
  // 14-day streak claiming late collects the big one first and the rest follow on
  // the next taps, instead of making somebody work up the ladder.
  const claimable: StreakMilestoneStatus | null =
    streak?.milestones
      .filter((m) => m.earned && !m.claimed && !claimedRef.current.has(m.days))
      .at(-1) ?? null;

  const claim = useCallback(
    async (days: number) => {
      if (claimingRef.current) return;
      claimingRef.current = true;
      setClaiming(true);
      setClaimError(null);
      try {
        const res = await claimFn({ data: { milestone: days } });
        if (!res.ok) {
          // Every one of these is something to say on the button. `claimed` is
          // the one a person can actually hit by tapping twice on a flaky
          // connection, and it means the card is already theirs.
          setClaimError(
            res.reason === "claimed"
              ? "Already collected — it's in your vault."
              : res.reason === "account_required"
                ? "Sign in first to keep it."
                : res.reason === "not_earned"
                  ? "That streak isn't there yet."
                  : "Nothing to give out right now. Try again in a bit.",
          );
          return;
        }
        claimedRef.current.add(days);
        setMilestoneReveal({
          milestone: res.milestone,
          streak: res.streak,
          card: res.card,
          // From the ladder rather than the response, so the reveal prints what
          // the rung promises even if an older server is still answering.
          tierFloor: streakMilestone(res.milestone)?.tierFloor ?? null,
          duplicate: res.duplicate,
        });
        await Promise.all([
          qc.invalidateQueries({ queryKey: streakStatusKey(actor) }),
          qc.invalidateQueries({ queryKey: mySecretsKey(actor) }),
          // A bonus pull is a non-duplicate row like any other, so the "pulled"
          // count behind the secret slot moves with it.
          qc.invalidateQueries({ queryKey: secretStatusKey(actor) }),
        ]);
      } catch {
        setClaimError("No signal. Tap to try again.");
      } finally {
        claimingRef.current = false;
        setClaiming(false);
      }
    },
    [claimFn, qc, actor],
  );

  const dismiss = useCallback(() => setMilestoneReveal(null), []);

  return { claimable, claiming, claimError, milestoneReveal, claim, dismiss };
}
