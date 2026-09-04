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

/** No rung has been taken on this run. Shared so the render allocates nothing. */
const EMPTY_DAYS: ReadonlySet<number> = new Set();

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
  // The rungs whose reveal has already played, and WHICH RUN they belong to.
  // The run is half the key because a broken-and-rebuilt streak makes every rung
  // earnable again — `claim_streak_milestone` keys a claim on the day the run
  // started, which is exactly what keeps the ladder re-earnable.
  //
  // Compared during render rather than cleared from an effect, because this is a
  // ref: clearing it in an effect changes nothing anybody is looking at until
  // something else happens to re-render, so the button stayed missing on the one
  // render that mattered.
  const claimedRef = useRef<{ run: string | null; days: Set<number> }>({
    run: null,
    days: new Set(),
  });
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [milestoneReveal, setMilestoneReveal] = useState<MilestoneRevealState | null>(null);

  /** Everything a claim can have moved, for whichever actor spent it. */
  const invalidateActor = useCallback(
    async (who: string | null) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: streakStatusKey(who) }),
        qc.invalidateQueries({ queryKey: mySecretsKey(who) }),
        // A bonus pull is a non-duplicate row like any other, so the "pulled"
        // count behind the secret slot moves with it.
        qc.invalidateQueries({ queryKey: secretStatusKey(who) }),
      ]);
    },
    [qc],
  );

  // Who the in-flight claim belongs to, read at the moment it lands rather than
  // captured when it was sent. A phone changing hands mid-party is a real thing
  // in this league, and a request sent by the last person used to resolve into
  // the next person's screen — showing them somebody else's card and handing
  // back a latch that was no longer theirs.
  const actorRef = useRef(actor);

  useEffect(() => {
    actorRef.current = actor;
    // The next person's milestones are their own, and a reveal left on screen
    // would be showing them somebody else's card.
    claimedRef.current = { run: null, days: new Set() };
    claimingRef.current = false;
    setClaiming(false);
    setClaimError(null);
    setMilestoneReveal(null);
  }, [actor]);

  const run = streak?.startedOn ?? null;
  // Only this run's latch counts. A rung taken on a run that has since been
  // broken says nothing about the rung on the run standing today.
  const shown = claimedRef.current.run === run ? claimedRef.current.days : EMPTY_DAYS;

  // The highest rung earned and not yet taken. Highest rather than lowest so a
  // 14-day streak claiming late collects the big one first and the rest follow on
  // the next taps, instead of making somebody work up the ladder.
  const claimable: StreakMilestoneStatus | null =
    streak?.milestones.filter((m) => m.earned && !m.claimed && !shown.has(m.days)).at(-1) ?? null;

  const claim = useCallback(
    async (days: number) => {
      if (claimingRef.current) return;
      claimingRef.current = true;
      setClaiming(true);
      setClaimError(null);
      // The actor this request is being sent AS. Every write below is guarded on
      // it still being the one holding the phone when the answer lands.
      const mine = actor;
      try {
        const res = await claimFn({ data: { milestone: days } });
        if (actorRef.current !== mine) return;
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
          // "Already collected" means somebody — another device, or a first
          // attempt whose response was lost — has banked the card. Everything
          // this screen believes about the ladder and the collection is a
          // response behind, so ask again rather than leaving the button
          // offering a rung that is already spent.
          if (res.reason === "claimed") await invalidateActor(mine);
          return;
        }
        // Re-keyed rather than added to when the run underneath has moved on.
        claimedRef.current =
          claimedRef.current.run === run
            ? { run, days: new Set(claimedRef.current.days).add(days) }
            : { run, days: new Set([days]) };
        setMilestoneReveal({
          milestone: res.milestone,
          streak: res.streak,
          card: res.card,
          // From the ladder rather than the response, so the reveal prints what
          // the rung promises even if an older server is still answering.
          tierFloor: streakMilestone(res.milestone)?.tierFloor ?? null,
          duplicate: res.duplicate,
        });
        await invalidateActor(mine);
      } catch {
        if (actorRef.current !== mine) return;
        setClaimError("No signal. Tap to try again.");
      } finally {
        // Only the sender's own latch. Clearing it after the phone changed hands
        // would hand the next person a control the reset effect had just armed.
        if (actorRef.current === mine) {
          claimingRef.current = false;
          setClaiming(false);
        }
      }
    },
    [claimFn, invalidateActor, actor, run],
  );

  const dismiss = useCallback(() => setMilestoneReveal(null), []);

  return { claimable, claiming, claimError, milestoneReveal, claim, dismiss };
}
