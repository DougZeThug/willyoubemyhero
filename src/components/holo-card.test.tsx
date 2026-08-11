// The flip's two constants, and the relationship between them.
//
// This is not a test of how the card looks. It is a test of the one thing about
// the flip that breaks silently: `.holo-face` swaps which side is visible at
// `FLIP_EDGE_AT` through the turn, and that moment is a property of `FLIP_CURVE`,
// not a round number. Get it wrong and the wrong face shows, mirrored, for a
// couple of frames — on WebKit only, which the Chromium-only e2e suite will never
// catch.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HoloCard, FLIP_CURVE, FLIP_EDGE_AT } from "./holo-card";
import { rarityStyle } from "@/lib/card-rarity";

/** One axis of a cubic bezier, as CSS defines it: implicit 0 and 1 endpoints. */
function axis(p1: number, p2: number, t: number): number {
  return 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3;
}

function parseCurve(css: string): [number, number, number, number] {
  const nums = css.match(/-?[\d.]+/g)!.map(Number);
  return [nums[0], nums[1], nums[2], nums[3]];
}

/**
 * The fraction of the duration at which the curve's output first reaches
 * `target` — for a 180° turn, 0.5 is the card standing edge-on to the camera.
 */
function timeAtOutput(css: string, target: number): number {
  const [x1, y1, x2, y2] = parseCurve(css);
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (axis(y1, y2, mid) < target) lo = mid;
    else hi = mid;
  }
  return axis(x1, x2, (lo + hi) / 2);
}

describe("the flip curve", () => {
  it("puts the face swap where the card is actually edge-on", () => {
    // Solved rather than assumed. If FLIP_CURVE is retuned and FLIP_EDGE_AT is
    // not re-solved with it, this is what says so.
    expect(timeAtOutput(FLIP_CURVE, 0.5)).toBeCloseTo(FLIP_EDGE_AT, 2);
  });

  it("reaches edge-on well before the halfway point", () => {
    // Which is the whole reason FLIP_EDGE_AT exists rather than `flipMs / 2`.
    // A symmetric curve would make both correct and this constant pointless.
    expect(FLIP_EDGE_AT).toBeLessThan(0.45);
  });

  it("overshoots, so the card lands like an object rather than a value", () => {
    const [, y1, , y2] = parseCurve(FLIP_CURVE);
    let peak = 0;
    for (let i = 0; i <= 1000; i++) peak = Math.max(peak, axis(y1, y2, i / 1000));
    expect(peak).toBeGreaterThan(1);
    // And not so far that a trading card looks rubbery. Past about 6° the
    // rebound reads as a bounce rather than as weight.
    expect((peak - 1) * 180).toBeLessThan(6);
  });
});

describe("the card", () => {
  it("writes the edge-on moment from its own flip length", () => {
    // The daily secret turns in 1100ms against the roster's 500ms. A fixed value
    // here would swap the secret's faces a third of the way through its turn.
    const { container } = render(
      <HoloCard
        frontUrl={null}
        backUrl={null}
        name="Alice Ace"
        rarity={rarityStyle("base")}
        flipMs={1100}
        backContent={<div />}
      />,
    );
    const scene = container.querySelector<HTMLElement>(".holo-scene")!;
    expect(scene.style.getPropertyValue("--holo-flip-half")).toBe(
      `${Math.round(1100 * FLIP_EDGE_AT)}ms`,
    );
    expect(scene.style.getPropertyValue("--holo-flip-ms")).toBe("1100ms");
  });

  it("does not light up a card that has only just mounted", () => {
    // Thirty cards flaring as the vault scrolls past is the failure this guards.
    const { container } = render(
      <HoloCard
        frontUrl={null}
        backUrl={null}
        name="Alice Ace"
        rarity={rarityStyle("base")}
        backContent={<div />}
      />,
    );
    expect(container.querySelector(".holo-turning")).toBeNull();
    expect(container.querySelector(".holo-punch")).toBeNull();
    expect(screen.getByRole("button")).toBeInTheDocument();
  });
});
