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

describe("the edition frame", () => {
  const card = (props: Partial<React.ComponentProps<typeof HoloCard>> = {}) =>
    render(
      <HoloCard
        frontUrl={null}
        backUrl={null}
        name="Alice Ace"
        rarity={rarityStyle("base")}
        {...props}
      />,
    );

  it("mounts nothing at all for a standard finish", () => {
    // 70% of pulls. A frame here would be the ambient look of the app rather
    // than a signal.
    const { container } = card();
    expect(container.querySelector(".card-edition")).toBeNull();
  });

  it("mounts one frame, wearing the finish's own class", () => {
    const { container } = card({ edition: "platinum" });
    const frames = container.querySelectorAll(".card-edition");
    expect(frames).toHaveLength(1);
    expect(frames[0]).toHaveClass("card-edition-platinum");
  });

  it("gives a generated back its own frame", () => {
    // The trap this test exists for. Both faces are in the DOM at once, so each
    // needs exactly one frame — but `Overlays` covers the front and an *uploaded*
    // back, while a generated back re-renders a hand-picked subset. Left out of
    // that subset the frame vanishes the moment the card turns over, and only on
    // cards whose back art was never uploaded.
    const { container } = card({ edition: "gold", backContent: <div />, flipped: true });
    const faces = container.querySelectorAll(".holo-face");
    expect(faces).toHaveLength(2);
    for (const face of faces) {
      expect(face.querySelectorAll(".card-edition")).toHaveLength(1);
    }
  });

  it("gives an uploaded back exactly one frame, not two", () => {
    // The mirror, and the reason the frame is a named variable rather than
    // inlined into `Overlays` — prismEdge was moved out for exactly this: an
    // uploaded back renders `Overlays` itself, so an inlined copy would stack.
    const { container } = card({ edition: "gold", backUrl: "/back.png", flipped: true });
    for (const face of container.querySelectorAll(".holo-face")) {
      expect(face.querySelectorAll(".card-edition")).toHaveLength(1);
    }
  });

  it("animates a platinum only at hero size", () => {
    // A vault grid of thirty permanently animating compositor layers is the cost
    // .holo-idle is gated to avoid, and the frame has to be gated the same way.
    const { container: hero } = card({ edition: "platinum", tilt: "hero" });
    expect(hero.querySelector(".card-edition")).toHaveClass("is-sheening");

    const { container: calm } = card({ edition: "platinum", tilt: "calm" });
    expect(calm.querySelector(".card-edition")).not.toHaveClass("is-sheening");
  });

  it("leaves the quieter finishes unanimated even at hero size", () => {
    const { container } = card({ edition: "gold", tilt: "hero" });
    expect(container.querySelector(".card-edition")?.className).not.toContain("is-sheening");
  });

  it("writes the metal variables without touching the tier's", () => {
    // Two axes, two variable namespaces. Sharing one is how a finish would start
    // quietly overwriting a tier's foil.
    const { container } = card({ edition: "gold", rarity: rarityStyle("champion") });
    const scene = container.querySelector<HTMLElement>(".holo-scene")!;
    expect(scene.style.getPropertyValue("--edn-a")).toBeTruthy();
    expect(scene.style.getPropertyValue("--edn-spec")).toBeTruthy();
    expect(scene.style.getPropertyValue("--holo-a")).toBe(rarityStyle("champion").holoA);
  });

  it("names the finish to a screen reader, alongside the tier", () => {
    card({ edition: "platinum", rarity: rarityStyle("podium") });
    // Both axes, never merged — "Gold" is podium's tier label, so a gold-finish
    // podium card has to read as two separate facts.
    expect(screen.getByText(/Gold card, Platinum/)).toBeInTheDocument();
  });

  it("says nothing extra for a standard finish", () => {
    card({ rarity: rarityStyle("base") });
    expect(screen.getByText(/Base card/)).toBeInTheDocument();
    expect(screen.queryByText(/Platinum|Bronze|Silver/)).toBeNull();
  });
});
