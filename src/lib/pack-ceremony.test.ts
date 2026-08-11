// The ceremony timeline. The properties worth pinning are that the clock is
// total — every millisecond maps to exactly one phase, including the ones either
// side of the run — and that the fan is symmetric, because an asymmetric fan
// reads as a bug rather than as a hand of cards.
import { describe, expect, it } from "vitest";
import {
  CEREMONY,
  CEREMONY_MS,
  CEREMONY_START,
  ceremonyPhaseAt,
  ceremonyReached,
  deckTransform,
  fanTransform,
  packJitter,
  riseTransform,
  type CeremonyPhase,
} from "./pack-ceremony";

describe("the timeline", () => {
  it("totals the phases rather than hard-coding a number that can drift", () => {
    expect(CEREMONY_MS).toBe(CEREMONY.reduce((n, s) => n + s.ms, 0));
  });

  it("runs about as long as a rip actually takes to watch", () => {
    // Loose bounds on purpose: this is a taste range, not a contract. It exists
    // so a stray zero in the table shows up as a failing test.
    //
    // Halved from the old 3–6s window. The sequence is not shorter because it was
    // trimmed — it is shorter because the two phases that held still were given
    // something to do, and a phase that is always changing does not need as long.
    expect(CEREMONY_MS).toBeGreaterThan(1500);
    expect(CEREMONY_MS).toBeLessThan(3000);
  });

  /**
   * The reason the timeline was retuned, pinned so it cannot quietly regress.
   *
   * The old table's failure was not its length, it was that it contained dead
   * air: a 360ms phase where the pack simply sat open and a 560ms one where the
   * fan hung still. Anything long enough to notice is long enough to need
   * something happening in it.
   */
  it("has no phase long enough to read as a pause", () => {
    for (const step of CEREMONY) {
      expect(step.ms).toBeLessThanOrEqual(600);
    }
    // The rule is about dead air, not length, so the one phase where nothing
    // moves keeps the tighter ceiling: `hold` is a beat, never a pause.
    const hold = CEREMONY.find((s) => s.phase === "hold");
    expect(hold!.ms).toBeLessThanOrEqual(340);
  });

  it("starts each phase where the previous one ended", () => {
    let at = 0;
    for (const step of CEREMONY) {
      expect(CEREMONY_START[step.phase]).toBe(at);
      at += step.ms;
    }
    expect(CEREMONY_START.done).toBe(CEREMONY_MS);
  });
});

describe("ceremonyPhaseAt", () => {
  it("opens on the first phase in the table", () => {
    expect(ceremonyPhaseAt(0)).toBe(CEREMONY[0].phase);
  });

  it("lands each phase on its own first millisecond", () => {
    for (const step of CEREMONY) {
      expect(ceremonyPhaseAt(CEREMONY_START[step.phase])).toBe(step.phase);
    }
  });

  it("is done once the clock runs out, and stays done", () => {
    expect(ceremonyPhaseAt(CEREMONY_MS)).toBe("done");
    expect(ceremonyPhaseAt(CEREMONY_MS + 10_000)).toBe("done");
  });

  // A rAF can fire with a timestamp fractionally ahead of the start stamp taken
  // in the pointer handler, and NaN is one bad subtraction away. Neither should
  // be able to take the ceremony somewhere it has no frame for.
  it("answers the first phase for a clock that has not started", () => {
    expect(ceremonyPhaseAt(-1)).toBe(CEREMONY[0].phase);
    expect(ceremonyPhaseAt(Number.NaN)).toBe(CEREMONY[0].phase);
  });

  it("never skips a phase as the clock advances", () => {
    const order = [...CEREMONY.map((s) => s.phase), "done" as const];
    let seen = 0;
    for (let ms = 0; ms <= CEREMONY_MS + 50; ms += 10) {
      const at = order.indexOf(ceremonyPhaseAt(ms));
      expect(at).toBeGreaterThanOrEqual(seen);
      expect(at).toBeLessThanOrEqual(seen + 1);
      seen = at;
    }
    expect(seen).toBe(order.length - 1);
  });
});

describe("ceremonyReached", () => {
  it("is true for the phase itself and everything behind it", () => {
    expect(ceremonyReached("rip", "fan")).toBe(true);
    expect(ceremonyReached("fan", "fan")).toBe(true);
  });

  it("is false for a phase still ahead", () => {
    expect(ceremonyReached("handoff", "fan")).toBe(false);
  });

  it("counts everything as reached once the run is over", () => {
    for (const step of CEREMONY) {
      expect(ceremonyReached(step.phase, "done")).toBe(true);
    }
  });
});

describe("fanTransform", () => {
  const xs = (n: number) => Array.from({ length: n }, (_, i) => fanTransform(i, n));

  it("puts a lone card dead centre instead of dividing by zero", () => {
    const only = fanTransform(0, 1);
    expect(only.x).toBe(0);
    expect(only.rotate).toBe(0);
    expect(Number.isFinite(only.y)).toBe(true);
    expect(Number.isFinite(only.z)).toBe(true);
  });

  it("is symmetric about the centre, which is what makes it read as a fan", () => {
    for (const n of [2, 3, 4, 5]) {
      const cards = xs(n);
      for (let i = 0; i < n; i++) {
        const mirror = cards[n - 1 - i];
        expect(cards[i].x).toBeCloseTo(-mirror.x);
        expect(cards[i].rotate).toBeCloseTo(-mirror.rotate);
        expect(cards[i].y).toBeCloseTo(mirror.y);
        expect(cards[i].z).toBeCloseTo(mirror.z);
      }
    }
  });

  it("spreads left to right", () => {
    const cards = xs(4);
    for (let i = 1; i < cards.length; i++) {
      expect(cards[i].x).toBeGreaterThan(cards[i - 1].x);
    }
  });

  // The arc is the difference between a hand of cards and a row of them.
  it("lifts the middle of the fan above its ends", () => {
    const cards = xs(5);
    expect(cards[2].y).toBeLessThan(cards[0].y);
    expect(cards[2].z).toBeGreaterThan(cards[0].z);
  });

  it("holds every card in front of the pack", () => {
    for (const card of xs(4)) {
      expect(card.z).toBeGreaterThan(0);
      expect(card.y).toBeLessThan(0);
    }
  });

  /**
   * The pack is three cards most days and four on a day with a secret in it, and
   * the fan has to fit a phone on both. A fixed per-card step did not: four cards
   * spread half a pack wider than three, and `html, body` carry
   * `overflow-x: hidden`, so the outer cards would have been silently clipped
   * rather than pushing a scrollbar anybody could notice.
   */
  it("spans the same width whether it is holding three cards or four", () => {
    const width = (n: number) => {
      const cards = xs(n);
      return cards[n - 1].x - cards[0].x;
    };
    expect(width(4)).toBeCloseTo(width(3));
    // Ceiling, not a target: the fan has to stay inside the 320px pack column,
    // where a card in the fan is about 159px wide. 140 keeps the outer edges
    // clear of it with room to spare.
    expect(width(3)).toBeLessThanOrEqual(140);
  });

  it("tilts across the same total angle at three cards or four", () => {
    const tilt = (n: number) => {
      const cards = xs(n);
      return cards[n - 1].rotate - cards[0].rotate;
    };
    expect(tilt(4)).toBeCloseTo(tilt(3));
  });

  // Two cards should sit close together rather than stretching to fill the width
  // four of them need, so the step is capped rather than purely divided.
  it("does not stretch a two-card fan to the full width", () => {
    const two = xs(2);
    expect(two[1].x - two[0].x).toBeLessThan(xs(3)[2].x - xs(3)[0].x);
  });
});

/**
 * Depth, which is the difference between a stack of cards and one thick card.
 *
 * The scales here are small — 1.5% a card — and that is deliberate: the
 * perspective is already doing most of the work, and this is only the part of the
 * separation perspective cannot carry at these distances.
 */
describe("depth", () => {
  it("shrinks each card behind the one in front of it, in both stacks", () => {
    for (const pose of [riseTransform, deckTransform]) {
      const cards = Array.from({ length: 4 }, (_, i) => pose(i, 4));
      expect(cards[0].scale).toBe(1);
      for (let i = 1; i < cards.length; i++) {
        expect(cards[i].scale).toBeLessThan(cards[i - 1].scale);
      }
      // Small enough that the back of a four-card pack is still recognisably the
      // same size of object as the front of it.
      expect(cards[3].scale).toBeGreaterThan(0.94);
    }
  });

  it("holds every card in the fan at one size", () => {
    // A fan is cards held out at the same distance, so they are the same size in
    // it. The `z` arc already renders the outer ones fractionally smaller, which
    // is the only size difference a real hand of cards has — and a per-card scale
    // here would break the mirror symmetry below.
    for (const card of Array.from({ length: 4 }, (_, i) => fanTransform(i, 4))) {
      expect(card.scale).toBe(1);
    }
  });

  it("separates the deck far enough to count its edges", () => {
    // Two pixels apart is a deck you have to be told is a deck. This is the
    // assertion that stops the gather being tidied back into a single card.
    const cards = Array.from({ length: 3 }, (_, i) => deckTransform(i, 3));
    for (let i = 1; i < cards.length; i++) {
      expect(Math.abs(cards[i].x - cards[i - 1].x)).toBeGreaterThanOrEqual(3);
      expect(Math.abs(cards[i].y - cards[i - 1].y)).toBeGreaterThanOrEqual(3);
    }
  });

  /**
   * The guard on where the untidiness lives.
   *
   * Cards are given a seeded per-card wonk so the fan does not look machined, and
   * it belongs in pack-opening.tsx, layered on top of this. If it ever moves in
   * here the symmetry tests above and below start failing intermittently, which
   * is a miserable thing to debug — so this states the rule outright.
   */
  it("is a pure function of the slot, with nothing random in it", () => {
    for (const pose of [riseTransform, fanTransform, deckTransform]) {
      for (let i = 0; i < 4; i++) {
        expect(pose(i, 4)).toEqual(pose(i, 4));
      }
    }
  });
});

/**
 * The untidiness, which is the difference between a hand of cards and a diagram.
 *
 * Seeded rather than random, so two people opening the same pack side by side see
 * the same thing — the same property the ragged tear edge has, and worth the same
 * care: a re-render mid-flight must not re-roll a card's angle underneath it.
 */
describe("packJitter", () => {
  it("gives the same pack the same wonk every time", () => {
    expect(packJitter("seed-a", 4)).toEqual(packJitter("seed-a", 4));
  });

  it("gives two different packs different wonk", () => {
    expect(packJitter("seed-a", 4)).not.toEqual(packJitter("seed-b", 4));
  });

  it("gives each card in a pack its own, rather than one for all of them", () => {
    const [a, b, c] = packJitter("seed-a", 3);
    expect(a.rotate).not.toBeCloseTo(b.rotate);
    expect(b.rotate).not.toBeCloseTo(c.rotate);
  });

  it("stays inside the range where it reads as handled rather than broken", () => {
    for (const j of packJitter("seed-a", 4)) {
      expect(Math.abs(j.rotate)).toBeLessThanOrEqual(2);
      // The spring multipliers have to keep every card arriving inside its own
      // phase. A card still travelling when its phase ends teleports to the next
      // mark, which is the one failure mode worse than no variation at all.
      expect(j.stiffness).toBeGreaterThan(0.85);
      expect(j.stiffness).toBeLessThan(1.15);
      expect(j.damping).toBeGreaterThan(0.85);
      expect(j.damping).toBeLessThan(1.15);
      expect(j.breath).toBeGreaterThan(0.5);
      expect(j.breath).toBeLessThan(1.5);
    }
  });

  it("answers for however many cards the pack is holding", () => {
    expect(packJitter("seed-a", 3)).toHaveLength(3);
    expect(packJitter("seed-a", 4)).toHaveLength(4);
    // A pack that has not been dealt yet asks for none, and must not throw.
    expect(packJitter("seed-a", 0)).toEqual([]);
  });
});

describe("riseTransform", () => {
  // Same ordering as the deck, and for the same reason: `layer()` paints card 0
  // on top, so card 0 has to be the one at the front of the stack.
  it("puts card 0 at the front of the stack", () => {
    const top = riseTransform(0, 3);
    expect(top.x).toBe(0);
    expect(top.rotate).toBe(0);
    for (let i = 1; i < 3; i++) {
      expect(riseTransform(i, 3).x).toBeGreaterThan(top.x);
      expect(riseTransform(i, 3).z).toBeLessThan(top.z);
    }
  });

  it("brings the cards out as a stack, not as a fan", () => {
    const cards = Array.from({ length: 3 }, (_, i) => riseTransform(i, 3));
    for (const card of cards) {
      // Anything past a few px sideways here and the "out, then open" reading is
      // gone before the fan has had a chance to make it.
      expect(Math.abs(card.x)).toBeLessThan(12);
      expect(card.y).toBeLessThan(0);
    }
  });

  it("clears the mouth without reaching where the fan will be", () => {
    for (let i = 0; i < 3; i++) {
      expect(riseTransform(i, 3).y).toBeGreaterThan(fanTransform(i, 3).y);
    }
  });
});

describe("deckTransform", () => {
  /**
   * Card 0 is the one PackStand mounts over a beat later, so any offset it still
   * carries is a visible jump at the handoff. This used to count depth from the
   * back, which put card 0 at the *far* end of the stack while `layer()` painted
   * it on top — the visible card was the one furthest off the mark.
   */
  it("lands card 0 on the stand's mark, with the rest stacked behind it", () => {
    const n = 3;
    const top = deckTransform(0, n);
    expect(top.x).toBe(0);
    expect(top.rotate).toBe(0);
    expect(top.z).toBeCloseTo(0);
    for (let i = 1; i < n; i++) {
      expect(deckTransform(i, n).x).toBeGreaterThan(top.x);
      expect(deckTransform(i, n).z).toBeLessThan(top.z);
    }
  });

  it("keeps the deck tight enough to read as one stack", () => {
    for (let i = 0; i < 4; i++) {
      expect(Math.abs(deckTransform(i, 4).rotate)).toBeLessThan(4);
    }
  });

  // The stand mounts with its card near the middle of the same column. A deck
  // that gathered where the fan hovered would hand over with a visible jump.
  it("settles back down toward the pack rather than staying where it hovered", () => {
    for (let i = 0; i < 3; i++) {
      expect(deckTransform(i, 3).y).toBeGreaterThan(fanTransform(i, 3).y);
      expect(deckTransform(i, 3).y).toBeGreaterThan(riseTransform(i, 3).y);
    }
  });
});

// The phases are strings in a union, and a typo in one of them is a silent
// no-op at runtime. This is the cheapest way to notice.
describe("the phase names", () => {
  it("has no duplicates", () => {
    const names: CeremonyPhase[] = CEREMONY.map((s) => s.phase);
    expect(new Set(names).size).toBe(names.length);
  });
});
