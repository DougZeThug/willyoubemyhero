// The stand's phase machine.
//
// One property is worth more than everything else in this file: there is no
// phase in which a roster card and the secret both own the stage, and no route
// from one to the other that skips the beat where the stage is bare. Both are
// asserted exhaustively rather than by example, because "we tried the paths we
// thought of" is exactly how the bug this machine replaces survived.
import { describe, expect, it } from "vitest";
import {
  secretOwnsStage,
  stageCard,
  standPhaseNext,
  standPhaseTimer,
  STAND_BEAT,
  STAND_PHASES,
  type StandEvent,
  type StandPhase,
} from "./stand-phase";

/** Every event, with both variants of the one that carries a payload. */
const EVENTS: StandEvent[] = [
  { type: "leftSecret" },
  { type: "atSecret", pretend: true },
  { type: "atSecret", pretend: false },
  { type: "pretenceOver" },
  { type: "glitchOver" },
  { type: "cardExited" },
  { type: "beatOver" },
];

describe("the invariant the machine exists for", () => {
  it("never has a roster card on the stage while the secret owns it", () => {
    for (const phase of STAND_PHASES) {
      expect(secretOwnsStage(phase) && stageCard(phase) === "roster").toBe(false);
    }
  });

  /**
   * The reason `clearing` and `empty` are separate phases rather than a timer.
   *
   * A walk of the whole reachable graph, so a future edge that quietly wires
   * `glitch` straight to `secret` fails here rather than on somebody's phone.
   */
  it("cannot reach the secret without passing through a bare stage", () => {
    const seen = new Set<StandPhase>(["roster"]);
    const queue: { at: StandPhase; bare: boolean }[] = [{ at: "roster", bare: false }];
    const arrivals: boolean[] = [];

    // Paths rather than phases, so a route that reaches `secret` a second way
    // is checked a second time. Bounded by the phase count either way.
    while (queue.length) {
      const { at, bare } = queue.shift()!;
      for (const ev of EVENTS) {
        const to = standPhaseNext(at, ev);
        if (to === at) continue;
        // `leftSecret` restarts the run; a bare stage seen before it does not
        // count toward the next trip to the secret.
        const stillBare = to === "roster" ? false : bare || stageCard(to) === null;
        if (to === "secret") {
          arrivals.push(stillBare);
          continue;
        }
        if (!seen.has(to)) {
          seen.add(to);
          queue.push({ at: to, bare: stillBare });
        }
      }
    }

    expect(arrivals.length).toBeGreaterThan(0);
    expect(arrivals.every(Boolean)).toBe(true);
  });

  it("reaches every phase from a roster card, so none of them is dead code", () => {
    const seen = new Set<StandPhase>(["roster"]);
    const queue: StandPhase[] = ["roster"];
    while (queue.length) {
      const at = queue.shift()!;
      for (const ev of EVENTS) {
        const to = standPhaseNext(at, ev);
        if (!seen.has(to)) {
          seen.add(to);
          queue.push(to);
        }
      }
    }
    expect([...seen].sort()).toEqual([...STAND_PHASES].sort());
  });
});

describe("the latch", () => {
  /**
   * The bug this machine was written for.
   *
   * `secretSlot` moves under the stand while the cursor is parked on the
   * secret's slot — "pending" to "sealed" when the pull lands, "sealed" to
   * "open" when the card is revealed — and the old effect treated each of those
   * as a fresh arrival, replaying the fake ending and remounting the last roster
   * card over the secret. Arriving again is now a no-op from everywhere but the
   * start.
   */
  it("ignores a second arrival at the secret from every phase but roster", () => {
    for (const phase of STAND_PHASES) {
      if (phase === "roster") continue;
      expect(standPhaseNext(phase, { type: "atSecret", pretend: true })).toBe(phase);
      expect(standPhaseNext(phase, { type: "atSecret", pretend: false })).toBe(phase);
    }
  });

  it("ignores a second cardExited, so the callback and the fallback cannot race", () => {
    const after = standPhaseNext("clearing", { type: "cardExited" });
    expect(after).toBe("empty");
    expect(standPhaseNext(after, { type: "cardExited" })).toBe("empty");
  });

  it("ignores an event that belongs to another phase", () => {
    expect(standPhaseNext("roster", { type: "pretenceOver" })).toBe("roster");
    expect(standPhaseNext("packComplete", { type: "beatOver" })).toBe("packComplete");
    expect(standPhaseNext("secret", { type: "glitchOver" })).toBe("secret");
  });
});

describe("walking on and off the secret's slot", () => {
  it("earns the twist when the run walked there", () => {
    expect(standPhaseNext("roster", { type: "atSecret", pretend: true })).toBe("packComplete");
  });

  /**
   * Reveal all, reduced motion, and a reload that landed on the slot. None of
   * them get the pretence — but all of them still clear the roster card first,
   * because that is correctness rather than choreography.
   */
  it("skips the pretence without skipping the handover", () => {
    expect(standPhaseNext("roster", { type: "atSecret", pretend: false })).toBe("clearing");
  });

  it("plays the twist in order", () => {
    let at: StandPhase = "roster";
    at = standPhaseNext(at, { type: "atSecret", pretend: true });
    expect(at).toBe("packComplete");
    at = standPhaseNext(at, { type: "pretenceOver" });
    expect(at).toBe("glitch");
    at = standPhaseNext(at, { type: "glitchOver" });
    expect(at).toBe("clearing");
    at = standPhaseNext(at, { type: "cardExited" });
    expect(at).toBe("empty");
    at = standPhaseNext(at, { type: "beatOver" });
    expect(at).toBe("secret");
  });

  it("resets from anywhere when the cursor steps back", () => {
    for (const phase of STAND_PHASES) {
      expect(standPhaseNext(phase, { type: "leftSecret" })).toBe("roster");
    }
  });
});

describe("what the stage is showing", () => {
  it("keeps the last roster card up through the whole pretence", () => {
    expect(stageCard("packComplete")).toBe("roster");
    expect(stageCard("glitch")).toBe("roster");
  });

  it("shows nothing at all while the stage is being cleared", () => {
    expect(stageCard("clearing")).toBeNull();
    expect(stageCard("empty")).toBeNull();
  });

  it("gives the secret the stage to itself", () => {
    expect(stageCard("secret")).toBe("secret");
    expect(secretOwnsStage("secret")).toBe(true);
    for (const phase of STAND_PHASES) {
      if (phase !== "secret") expect(secretOwnsStage(phase)).toBe(false);
    }
  });
});

describe("the beats", () => {
  it("arms a timer for exactly the phases that move themselves on", () => {
    expect(standPhaseTimer("roster", false)).toBeNull();
    expect(standPhaseTimer("secret", false)).toBeNull();
    for (const phase of ["packComplete", "glitch", "clearing", "empty"] as const) {
      expect(standPhaseTimer(phase, false)).not.toBeNull();
    }
  });

  it("arms the event that actually advances that phase", () => {
    for (const phase of STAND_PHASES) {
      const armed = standPhaseTimer(phase, false);
      if (!armed) continue;
      expect(standPhaseNext(phase, armed.event)).not.toBe(phase);
    }
  });

  it("collapses the beat that exists only to be watched under reduced motion", () => {
    expect(standPhaseTimer("empty", true)!.ms).toBe(0);
    // The twist is already skipped for reduced motion by `pretend`, so this
    // keeps its length — nothing reaches it with the preference on.
    expect(standPhaseTimer("packComplete", true)!.ms).toBe(STAND_BEAT.packComplete);
  });

  /**
   * The card unmounting is the thing that ends `clearing`, and the timer only
   * exists in case that never reports in. Shortening it for reduced motion
   * would turn the backstop into a competitor — which is how the heading ended
   * up announcing the fourth card over the third one in the first place.
   */
  it("keeps the deadlock breaker at full length whatever the preference", () => {
    expect(standPhaseTimer("clearing", true)!.ms).toBe(STAND_BEAT.clearing);
    expect(standPhaseTimer("clearing", false)!.ms).toBe(STAND_BEAT.clearing);
  });

  it("gives the exit far longer than it needs, rather than racing it", () => {
    // Well past any exit this stand runs. If it ever fires, something is wrong
    // and it is unsticking the sequence rather than timing it.
    expect(STAND_BEAT.clearing).toBeGreaterThan(1000);
  });

  it("adds up to a pause somebody would notice but not wait out", () => {
    const total = STAND_BEAT.packComplete + STAND_BEAT.glitch + STAND_BEAT.empty;
    expect(total).toBeGreaterThan(1000);
    expect(total).toBeLessThan(1600);
  });
});
