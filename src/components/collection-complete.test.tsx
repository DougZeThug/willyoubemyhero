import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setMatchMedia } from "@/test/setup";
import { CollectionComplete } from "./collection-complete";

// jsdom has no canvas, and canvas-confetti throws on a null 2d context.
vi.mock("@/lib/card-confetti", () => ({
  celebrateCollection: vi.fn(async () => {}),
}));
vi.mock("@/lib/card-sfx", () => ({
  cue: vi.fn(),
  playReveal: vi.fn(),
}));

import { celebrateCollection } from "@/lib/card-confetti";
import { cue, playReveal } from "@/lib/card-sfx";

/**
 * Real timers, deliberately. Cycling useFakeTimers leaves motion's rAF loop
 * holding a handle from a dead clock, and every test after the first hangs — the
 * same reason milestone-reveal.test.tsx does this.
 */
const tick = (ms: number) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });

function renderCeremony(over: Partial<React.ComponentProps<typeof CollectionComplete>> = {}) {
  const onDone = vi.fn();
  const view = render(<CollectionComplete label="Pets" size={9} onDone={onDone} {...over} />);
  return { onDone, ...view };
}

describe("CollectionComplete", () => {
  it("names the set that just closed", () => {
    renderCeremony();
    expect(screen.getByRole("dialog", { name: "Pets complete" })).toBeInTheDocument();
    expect(screen.getByText("Set complete")).toBeInTheDocument();
  });

  it("holds the number back until the seal has landed", async () => {
    // The whole shape of this ceremony. The size is the one thing the rest of the
    // feature refuses to say, so it does not get to appear alongside the label —
    // it arrives after, and it climbs.
    renderCeremony();
    expect(screen.queryByText("9 cards, all of them")).not.toBeInTheDocument();

    await tick(1000);
    expect(screen.getByText("9 cards, all of them")).toBeInTheDocument();
  });

  it("says it in the singular for a one-card set", async () => {
    renderCeremony({ size: 1 });
    await tick(1000);
    expect(screen.getByText("1 card, all of them")).toBeInTheDocument();
  });

  it("fires the confetti and the chime exactly once", async () => {
    // The celebratedRef latch. This mounts inside a route that re-renders on
    // every realtime tick, and a cannon that re-fires on each one is the bug
    // FinishCelebration's own comment was written about.
    const { rerender } = renderCeremony();
    rerender(<CollectionComplete label="Pets" size={9} onDone={vi.fn()} />);
    await tick(1000);

    expect(celebrateCollection).toHaveBeenCalledTimes(1);
    expect(cue).toHaveBeenCalledTimes(1);
    expect(cue).toHaveBeenCalledWith("collectionComplete");
    // The resolving chime, not the open secret bell.
    expect(playReveal).toHaveBeenCalledWith("collectionComplete");
  });

  it("goes straight to the number under reduced motion", async () => {
    // No seal beat and no count-up: a number nobody asked to watch climb is the
    // exact thing that setting turns off. The fact still lands.
    setMatchMedia((q) => q.includes("prefers-reduced-motion"));
    renderCeremony();
    expect(screen.getByText("9 cards, all of them")).toBeInTheDocument();
    expect(screen.getByText("9")).toBeInTheDocument();
  });

  it("dismisses on the button rather than on a timer", async () => {
    // Unlike FinishCelebration, which auto-dismisses after 4.2s: that one fires
    // unprompted on a shared screen. This one is the payoff for a season of
    // pulls and waits to be closed.
    const { onDone } = renderCeremony();
    await tick(1000);
    expect(onDone).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Every one" }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
