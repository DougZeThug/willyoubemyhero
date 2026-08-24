import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { setMatchMedia } from "@/test/setup";
import { MilestoneReveal } from "./milestone-reveal";
import type { SecretCardView } from "@/lib/secret-cards";

// jsdom has no canvas, and canvas-confetti throws on a null 2d context.
vi.mock("@/lib/card-confetti", () => ({
  burst: vi.fn(async () => {}),
  celebrate: vi.fn(async () => {}),
  celebrateSecret: vi.fn(async () => {}),
}));
vi.mock("@/lib/card-sfx", () => ({
  cue: vi.fn(),
  playReveal: vi.fn(),
  playSecretRiser: vi.fn(),
}));

import { celebrateSecret } from "@/lib/card-confetti";
import { cue, playReveal, playSecretRiser } from "@/lib/card-sfx";

const CARD: SecretCardView = {
  id: "00000000-0000-4000-8000-00000000ce01",
  name: "The Ghost",
  flavour: null,
  foil: "prism",
  borderFx: "spin",
  collection: null,
  artUrl: null,
  backUrl: null,
  tier: "rare",
};

/**
 * Real timers, deliberately. Cycling useFakeTimers leaves motion's rAF loop
 * holding a handle from a dead clock, and every test after the first hangs.
 */
const tick = (ms: number) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });

function renderReveal(over: Partial<React.ComponentProps<typeof MilestoneReveal>> = {}) {
  const onDone = vi.fn();
  const view = render(
    <MilestoneReveal
      milestone={7}
      streak={7}
      card={CARD}
      duplicate={false}
      onDone={onDone}
      {...over}
    />,
  );
  return { ...view, onDone };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  setMatchMedia(() => false);
});

describe("MilestoneReveal", () => {
  it("opens on the flame and the day count, before the card", () => {
    renderReveal();
    expect(screen.getByTestId("milestone-reveal")).toHaveTextContent("7 days in a row");
    expect(playSecretRiser).toHaveBeenCalled();
    expect(celebrateSecret).not.toHaveBeenCalled();
  });

  it("hands over to the card, with its chime and its confetti", async () => {
    renderReveal();
    await tick(1300);
    expect(cue).toHaveBeenCalledWith("secretImpact");
    expect(playReveal).toHaveBeenCalled();
    expect(celebrateSecret).toHaveBeenCalledTimes(1);
  });

  it("fires the cannon once, however long it sits there", async () => {
    renderReveal();
    await tick(1300);
    await tick(600);
    expect(celebrateSecret).toHaveBeenCalledTimes(1);
  });

  it("holds the confetti back for a duplicate, but still shows the card", async () => {
    // A duplicate was still bought with a month of showing up, so it gets the
    // reveal — it just does not get the cannon. Same rule the daily pull follows.
    renderReveal({ duplicate: true });
    await tick(1300);
    expect(celebrateSecret).not.toHaveBeenCalled();
    expect(screen.getByTestId("milestone-reveal")).toBeInTheDocument();
  });

  it("skips the flare entirely under reduced motion", () => {
    setMatchMedia((q) => q.includes("reduce"));
    renderReveal();
    // Straight to the card: no riser, and the milestone rather than a count-up.
    expect(playSecretRiser).not.toHaveBeenCalled();
    expect(screen.getByTestId("milestone-reveal")).toHaveTextContent("7 days in a row");
  });

  it("hands control back when it is dismissed", async () => {
    const { onDone } = renderReveal();
    await tick(1300);
    await act(async () => {
      screen.getByTestId("milestone-done").click();
    });
    expect(onDone).toHaveBeenCalled();
  });
});
