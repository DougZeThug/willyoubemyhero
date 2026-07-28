import { describe, expect, it, vi } from "vitest";
import { formatTime, hueOf, initialsOf, newClientKey, newSeed, seededRng, shuffle } from "./format";

describe("formatTime", () => {
  it("renders an em dash for a missing time", () => {
    expect(formatTime(null)).toBe("—");
    expect(formatTime(undefined)).toBe("—");
    expect(formatTime(NaN)).toBe("—");
  });

  it("renders zero", () => {
    expect(formatTime(0)).toBe("00.00");
  });

  it("pads seconds and hundredths below a minute", () => {
    expect(formatTime(1_230)).toBe("01.23");
    expect(formatTime(9_990)).toBe("09.99");
    expect(formatTime(59_990)).toBe("59.99");
  });

  it("switches to M:SS.hh at a minute", () => {
    expect(formatTime(60_000)).toBe("1:00.00");
    expect(formatTime(63_450)).toBe("1:03.45");
    expect(formatTime(600_000)).toBe("10:00.00");
  });

  it("does not roll minutes over into hours", () => {
    // A combine run is minutes long; an hour-plus reading means something is
    // wrong and should be visible, not silently reformatted.
    expect(formatTime(3_600_000)).toBe("60:00.00");
  });

  it("truncates hundredths rather than rounding", () => {
    // 1.239s must read 01.23, not 01.24 — a displayed time should never be
    // faster than the recorded one.
    expect(formatTime(1_239)).toBe("01.23");
    expect(formatTime(1_999)).toBe("01.99");
  });
});

describe("initialsOf", () => {
  it("takes the first letter of the first two words", () => {
    expect(initialsOf("Doug Weidensaul")).toBe("DW");
  });

  it("caps at two initials", () => {
    expect(initialsOf("Mary Jane Watson Parker")).toBe("MJ");
  });

  it("handles a single name", () => {
    expect(initialsOf("Prince")).toBe("P");
  });

  it("upper-cases", () => {
    expect(initialsOf("doug weidensaul")).toBe("DW");
  });

  it("survives an empty string and stray whitespace", () => {
    expect(initialsOf("")).toBe("");
    expect(initialsOf("   ")).toBe("");
    expect(initialsOf("  Doug   Weidensaul  ")).toBe("DW");
  });
});

describe("hueOf", () => {
  it("is deterministic", () => {
    expect(hueOf("alice")).toBe(hueOf("alice"));
  });

  it("stays inside the hue circle", () => {
    for (const seed of ["a", "alice", "", "🎉", "a-very-long-participant-identifier-0000"]) {
      const hue = hueOf(seed);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
      expect(Number.isInteger(hue)).toBe(true);
    }
  });

  it("separates different seeds", () => {
    expect(hueOf("alice")).not.toBe(hueOf("bob"));
  });
});

describe("seededRng", () => {
  it("replays the same sequence for the same seed", () => {
    const a = seededRng("2026-07-28");
    const b = seededRng("2026-07-28");
    const first = Array.from({ length: 10 }, () => a());
    const second = Array.from({ length: 10 }, () => b());
    expect(first).toEqual(second);
  });

  it("diverges for different seeds", () => {
    const a = Array.from({ length: 5 }, seededRng("seed-a"));
    const b = Array.from({ length: 5 }, seededRng("seed-b"));
    expect(a).not.toEqual(b);
  });

  it("produces values in [0, 1)", () => {
    const rng = seededRng("range-check");
    for (let i = 0; i < 500; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("does not immediately repeat itself", () => {
    const rng = seededRng("variety");
    const values = new Set(Array.from({ length: 50 }, () => rng()));
    expect(values.size).toBeGreaterThan(40);
  });
});

describe("shuffle", () => {
  const input = [1, 2, 3, 4, 5, 6, 7, 8];

  it("returns a permutation of the input", () => {
    const out = shuffle(input, seededRng("perm"));
    expect([...out].sort((a, b) => a - b)).toEqual(input);
  });

  it("does not mutate the input", () => {
    const original = [...input];
    shuffle(input, seededRng("no-mutate"));
    expect(input).toEqual(original);
  });

  it("is deterministic for a given seed — the league shares one pack", () => {
    const a = shuffle(input, seededRng("2026-07-28"));
    const b = shuffle(input, seededRng("2026-07-28"));
    expect(a).toEqual(b);
  });

  it("produces different orders for different seeds", () => {
    const a = shuffle(input, seededRng("monday"));
    const b = shuffle(input, seededRng("tuesday"));
    expect(a).not.toEqual(b);
  });

  it("handles empty and single-element arrays", () => {
    expect(shuffle([], seededRng("x"))).toEqual([]);
    expect(shuffle([9], seededRng("x"))).toEqual([9]);
  });

  it("touches every position over many runs — no fixed points by construction", () => {
    // A Fisher-Yates that starts the loop in the wrong place leaves index 0
    // pinned. Sampling many seeds catches that.
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) seen.add(shuffle(input, seededRng(`s${i}`))[0]);
    expect(seen.size).toBeGreaterThan(1);
  });

  it("defaults to Math.random", () => {
    const spy = vi.spyOn(Math, "random").mockReturnValue(0);
    shuffle(input);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("newSeed", () => {
  it("produces a non-empty, unique-ish string", () => {
    const seeds = new Set(Array.from({ length: 50 }, () => newSeed()));
    expect(seeds.size).toBeGreaterThan(45);
    for (const s of seeds) expect(s.length).toBeGreaterThan(8);
  });
});

describe("newClientKey", () => {
  it("returns 32 lowercase hex characters", () => {
    expect(newClientKey()).toMatch(/^[0-9a-f]{32}$/);
  });

  it("does not repeat", () => {
    const keys = new Set(Array.from({ length: 100 }, () => newClientKey()));
    expect(keys.size).toBe(100);
  });

  it("still produces a well-formed key without crypto.getRandomValues", () => {
    const original = globalThis.crypto;
    // @ts-expect-error — deliberately removing a global to exercise the fallback.
    delete globalThis.crypto;
    try {
      expect(newClientKey()).toMatch(/^[0-9a-f]{32}$/);
    } finally {
      globalThis.crypto = original;
    }
  });
});
