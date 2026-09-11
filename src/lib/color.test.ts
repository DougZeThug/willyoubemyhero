// The oklch → hex conversion, checked against the colours it actually has to
// carry: this app's own palette and its rarity tiers.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  compositeOver,
  contrast,
  oklchAlpha,
  oklchToHex,
  oklchToLinearRgb,
  relativeLuminance,
  srgb8ToLinear,
} from "./color";
import { rarityStyle, type RarityTier } from "./card-rarity";

describe("oklchToHex", () => {
  it("converts the house cyan to the cyan it renders as", () => {
    expect(oklchToHex("oklch(0.82 0.14 210)")).toBe("#13dcf6");
  });

  it("converts the tier colours to their own hues, not to one another", () => {
    // The bug this exists for: canvas-confetti's parser reduced every tier to
    // roughly the same olive, because they all start "oklch(0.8…". Distinct
    // output is the whole point.
    const seen = new Set(
      (["champion", "podium", "stationKing", "base", "penaltyBox", "dnf"] as RarityTier[]).map(
        (t) => oklchToHex(rarityStyle(t).accent),
      ),
    );
    expect(seen.size).toBe(6);
  });

  it("answers a real six-digit hex colour for every tier", () => {
    for (const tier of ["champion", "podium", "stationKing", "base", "penaltyBox", "dnf"]) {
      const hex = oklchToHex(rarityStyle(tier as RarityTier).accent);
      expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("keeps a gold reading as gold and a slate as a slate", () => {
    // Sanity beyond "it is six hex digits": the champion's gold must be
    // red-heavy and blue-light, and the DNF's slate must be near-neutral.
    const gold = oklchToHex("oklch(0.88 0.17 90)");
    const [gr, gg, gb] = [1, 3, 5].map((i) => parseInt(gold.slice(i, i + 2), 16));
    expect(gr).toBeGreaterThan(gb);
    expect(gg).toBeGreaterThan(gb);

    const slate = oklchToHex("oklch(0.62 0.02 240)");
    const [sr, sg, sb] = [1, 3, 5].map((i) => parseInt(slate.slice(i, i + 2), 16));
    expect(Math.max(sr, sg, sb) - Math.min(sr, sg, sb)).toBeLessThan(40);
  });

  it("accepts lightness as a percentage as well as a fraction", () => {
    expect(oklchToHex("oklch(82% 0.14 210)")).toBe(oklchToHex("oklch(0.82 0.14 210)"));
  });

  it("ignores the alpha slash form rather than choking on it", () => {
    expect(oklchToHex("oklch(0.82 0.14 210 / 45%)")).toBe("#13dcf6");
  });

  /**
   * Passing non-oklch through untouched is what lets the call sites stay clean:
   * a burst's colour list mixes tier colours with a plain white, and neither
   * needs a special case.
   */
  it("passes anything that is not oklch straight through", () => {
    expect(oklchToHex("#ffffff")).toBe("#ffffff");
    expect(oklchToHex("rebeccapurple")).toBe("rebeccapurple");
    expect(oklchToHex("oklch(nonsense)")).toBe("oklch(nonsense)");
  });

  it("clamps rather than wrapping when a colour sits outside sRGB", () => {
    // A chroma no display can show. The channels have to saturate at the edge of
    // the gamut, not overflow into an unrelated colour.
    expect(oklchToHex("oklch(0.7 0.9 150)")).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("the contrast primitives", () => {
  const white = oklchToLinearRgb("oklch(1 0 0)")!;
  const black = oklchToLinearRgb("oklch(0 0 0)")!;

  it("reads the alpha the conversion deliberately drops", () => {
    expect(oklchAlpha("oklch(1 0 0 / 35%)")).toBeCloseTo(0.35);
    expect(oklchAlpha("oklch(0.82 0.14 210 / 0.5)")).toBeCloseTo(0.5);
    // No alpha written is opaque, not zero — the difference between a border
    // that measures and one that reads as absent.
    expect(oklchAlpha("oklch(0.82 0.14 210)")).toBe(1);
  });

  it("puts black on white at 21:1 and a colour against itself at 1:1", () => {
    expect(contrast(white, black)).toBeCloseTo(21, 1);
    expect(contrast(white, white)).toBeCloseTo(1, 5);
  });

  it("composites toward the backdrop as alpha falls", () => {
    expect(relativeLuminance(compositeOver(white, 1, black))).toBeCloseTo(1, 5);
    expect(relativeLuminance(compositeOver(white, 0, black))).toBeCloseTo(0, 5);
    // Mid-alpha white on black is ~0.216, not 0.5: the blend is in gamma space,
    // which is the whole reason a linear-light blend would report the wrong
    // number for every edge in the app.
    expect(relativeLuminance(compositeOver(white, 0.5, black))).toBeCloseTo(0.216, 2);
  });

  it("round-trips an 8-bit pixel back to the same light", () => {
    expect(srgb8ToLinear(255, 255, 255)).toEqual(white);
    expect(relativeLuminance(srgb8ToLinear(0, 0, 0))).toBe(0);
  });
});

describe("the interactive border token", () => {
  // WCAG 1.4.11 asks 3:1 for the boundary of a control, and every edge in this
  // app was 1.25:1 before the token split (§23 F3). The numbers are pinned here
  // rather than eyeballed because the audit itself proposed 24% white and called
  // it "~3.1:1" — it measures 2.05, and nothing in the repo could contradict it.
  //
  // cwd rather than import.meta.url: this file runs in the jsdom project, where
  // import.meta.url is not a file: URL and node:fs refuses it.
  const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

  /** Every `--name: value;` declared in the `:root` block. */
  const tokens = new Map(
    [
      ...(/:root\s*\{([\s\S]*?)\n\s*\}/.exec(css)?.[1] ?? "").matchAll(
        /^\s*(--[\w-]+):\s*([^;]+);/gm,
      ),
    ].map((m) => [m[1], m[2].trim()] as const),
  );

  /** One level of `var(--x)` indirection, which is all these tokens use. */
  const resolve1 = (name: string) => {
    const raw = tokens.get(name);
    const via = raw && /^var\((--[\w-]+)\)$/.exec(raw);
    return via ? tokens.get(via[1]) : raw;
  };

  const GROUNDS = ["--bg", "--background", "--surface", "--card"] as const;

  /** A translucent edge composited on a ground, against that ground. */
  const edgeContrast = (edge: string, ground: string) => {
    const fg = oklchToLinearRgb(edge);
    const bg = oklchToLinearRgb(ground);
    if (!fg || !bg) throw new Error(`not oklch: ${edge} / ${ground}`);
    return contrast(compositeOver(fg, oklchAlpha(edge), bg), bg);
  };

  it("is minted as a Tailwind utility, not just declared", () => {
    // The half that has no visible symptom. Without the @theme inline line
    // Tailwind emits no border-border-strong class at all, every swept element
    // falls back through `* { border-color: var(--color-border) }` to the faint
    // value, and the whole change renders exactly as it did before.
    expect(tokens.get("--border-strong")).toBe("oklch(1 0 0 / 35%)");
    expect(css).toMatch(/--color-border-strong:\s*var\(--border-strong\);/);
  });

  it("clears 3:1 against every ground the app paints it on", () => {
    const edge = resolve1("--border-strong")!;
    for (const ground of GROUNDS) {
      const ratio = edgeContrast(edge, resolve1(ground)!);
      expect(ratio, `--border-strong on ${ground} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
        3,
      );
    }
  });

  it("carries every shadcn control edge with it", () => {
    // ui/input.tsx, textarea, select, toggle, input-otp, calendar and the
    // outline button all draw border-input, so this one line is what reaches
    // them without editing an unmodified primitive.
    expect(resolve1("--input")).toBe(resolve1("--border-strong"));
  });

  it("leaves the decorative hairline where it was", () => {
    // The faint rule is right between things. A later audit item that "fixes"
    // contrast by raising this instead moves ~70 bare `border` call sites at
    // once, through the global * rule.
    expect(tokens.get("--border")).toBe("oklch(1 0 0 / 10%)");
    const ratio = edgeContrast(resolve1("--border")!, resolve1("--bg")!);
    expect(ratio).toBeLessThan(2);
  });

  it("reaches the two control edges that are written in CSS, not in classes", () => {
    // .neon-btn-quiet and .tier-chip paint their own borders, so no className
    // assertion anywhere could notice either one being reverted.
    expect(css).toMatch(/\.neon-btn-quiet\s*\{[^}]*border:\s*1px solid var\(--border-strong\);/);
    expect(css).toMatch(/\.tier-chip\s*\{[^}]*border-color:\s*var\(--border-strong\);/);
  });

  it("keeps the quiet button's hover edge brighter than its resting one", () => {
    // The trap in raising a rest state: this hover was 25% white, chosen to sit
    // above a 15% rest. Against 35% it would have read as a dimmer edge under
    // whatever was touched last.
    //
    // This comment used to finish "and Tailwind's hover: variants are not gated
    // by the (hover: hover) media query the way styles.css's own rules are",
    // which is false: v4 compiles every hover: utility inside that query, so a
    // thumb never reached one. It does now — styles.css's `@custom-variant hover`
    // promotes them to :active where there is no hover — which is what finally
    // makes the inversion this test guards against something a phone can show.
    const hover = /\.neon-btn-quiet:hover\s*\{[^}]*border-color:\s*(oklch\([^)]*\));/.exec(
      css,
    )?.[1];
    expect(hover).toBeDefined();
    const ground = oklchToLinearRgb(resolve1("--bg")!)!;
    const white = oklchToLinearRgb("oklch(1 0 0)")!;
    const rest = compositeOver(white, oklchAlpha(resolve1("--border-strong")!), ground);
    const lit = compositeOver(white, oklchAlpha(hover!), ground);
    expect(relativeLuminance(lit)).toBeGreaterThan(relativeLuminance(rest));
  });
});
