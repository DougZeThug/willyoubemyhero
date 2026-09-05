import { useEffect } from "react";
import { editionCelebrates, editionStyle, type Edition } from "@/lib/card-edition";
import { playEditionShine, playReveal } from "@/lib/card-sfx";
import { markRevealed, readRevealedAt, shouldCelebrate } from "@/lib/reveal-seen";
import type { Rarity } from "@/lib/card-rarity";

/**
 * Cards whose reveal has already played this page load.
 *
 * Arrowing back and forth through the roster re-mounts the same card over and
 * over, and a chime on every pass turns a flourish into a machine gun.
 *
 * THE FALLBACK NOW, NOT THE RULE. §6: keying the once-guard on module lifetime
 * meant every fresh session re-fired the chime card by card, and a good card
 * re-fired the confetti, spending a little of the pack reveal's currency each
 * time. wwbh:reveal-seen keys it on ACQUISITION instead — but only for a card
 * whose acquisition this device actually knows about, which is the ones inside
 * the vault's own "new since" window. A collection built before this shipped, or
 * a card pulled last month, has no timestamp to key on, and for those this Set is
 * still the whole guard and still does the job it was written for.
 *
 * Module-scoped rather than a ref, deliberately: the guard has to outlive the
 * component, and since §7 the surface that plays the cue is the full-screen
 * viewer, which mounts and unmounts every time somebody drops to the details
 * page and back. A ref would reset on the way down and re-fire on the way up.
 */
const revealed = new Set<string>();

/** Test seam. Nothing in the app clears this — a page load is the reset. */
export function resetRevealedForTests() {
  revealed.clear();
}

/**
 * Landing on a card is an event: the tier chime, and a burst in the tier's own
 * colour for the two tiers worth celebrating. A cold page load has no user
 * gesture behind it, so the AudioContext stays suspended and this is silent —
 * which is the correct behaviour, not something to work around.
 *
 * §7 moved this off the details page and onto the viewer, which is what "landing
 * on a card" now means. `active` is that surface saying it is on screen; the
 * gates below are unchanged from when they lived in players.$id.tsx.
 */
export function useRevealCue({
  active,
  id,
  rarity,
  edition,
  acquiredAt,
  pending,
}: {
  /** The card is on screen, face up, on the surface that owns the cue. */
  active: boolean;
  /** `event_participants.id`, or null before the bundle lands. */
  id: string | null;
  rarity: Rarity;
  edition: Edition;
  /** When this copy arrived, if the acquisitions window knows. */
  acquiredAt: string | null;
  /** The acquisitions query is still in flight. */
  pending: boolean;
}) {
  useEffect(() => {
    // Never on a locked card, and never behind the details page. Landing on a
    // face-down slot is the opposite of a payoff, and a chime and confetti over
    // it would celebrate nothing.
    if (!active || !id) return;
    // Hold the cue for the one beat it takes to learn whether this card is new.
    // Firing first and finding out afterwards fires twice, because the answer
    // landing is itself a re-render.
    if (pending) return;
    // The session guard still comes first, and unconditionally: arrowing back and
    // forth re-mounts the same card, and this is what stops that being a machine
    // gun whatever the store says.
    if (revealed.has(id)) return;
    // Then the device store, which is the half that survives a reload — the whole
    // point of §6. `false` is "already celebrated"; `null` is "no opinion at all",
    // and for that the session guard above was the entire decision.
    if (shouldCelebrate(readRevealedAt(id), acquiredAt) === false) return;
    revealed.add(id);
    if (acquiredAt) markRevealed(id, acquiredAt);
    playReveal(rarity.tier);
    playEditionShine(edition);
    // The finish can carry a card the tier never would — same gate as the pack
    // stand, so landing on a platinum base card is an event on both screens.
    if (rarity.tier !== "champion" && rarity.tier !== "podium" && !editionCelebrates(edition))
      return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let cancelled = false;
    void import("canvas-confetti").then(({ default: confetti }) => {
      if (cancelled) return;
      confetti({
        particleCount: 90,
        spread: 75,
        origin: { y: 0.4 },
        colors: [
          rarity.accent,
          rarity.holoA,
          rarity.holoB,
          ...(editionCelebrates(edition) ? [editionStyle(edition).accent] : []),
          "#ffffff",
        ],
      });
    });
    return () => {
      cancelled = true;
    };
  }, [
    active,
    id,
    edition,
    rarity.tier,
    rarity.accent,
    rarity.holoA,
    rarity.holoB,
    acquiredAt,
    pending,
  ]);
}
