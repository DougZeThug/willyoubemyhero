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
    expect(CEREMONY_MS).toBeGreaterThan(1500);
    expect(CEREMONY_MS).toBeLessThan(3000);
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
  it("opens on the rip", () => {
    expect(ceremonyPhaseAt(0)).toBe("rip");
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
    expect(ceremonyPhaseAt(-1)).toBe("rip");
    expect(ceremonyPhaseAt(Number.NaN)).toBe("rip");
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
    expect(ceremonyReached("collapse", "fan")).toBe(false);
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
