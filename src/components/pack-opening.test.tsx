// The opening ceremony's contract with the rest of the app.
//
// The animation itself is not testable here — motion does not tick in jsdom, and
// pinning transform strings would be a test of the tuning rather than of the
// behaviour. What *is* worth pinning is everything the ceremony can silently
// break: when it hands over, that it hands over exactly once however it is ended,
// and that it never puts an element on the page matching the selector the e2e
// suite uses to find the card on the stand.
import { render, screen, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PackOpening } from "./pack-opening";
import { CEREMONY_MS, CEREMONY_START } from "@/lib/pack-ceremony";
import { setMatchMedia } from "@/test/setup";

function renderOpening(over: Partial<Parameters<typeof PackOpening>[0]> = {}) {
  const onTear = vi.fn(() => true);
  const onDone = vi.fn();
  const view = render(
    <PackOpening
      seed="seed-1"
      artUrl={null}
      packSize={3}
      year="2026"
      slots={3}
      onTear={onTear}
      onDone={onDone}
      {...over}
    />,
  );
  return { ...view, onTear, onDone };
}

/** Tear the pack the way the keyboard path does, then let the clock run to `ms`. */
async function tearAndRun(container: HTMLElement, ms: number) {
  const pack = container.querySelector('[role="button"]') as HTMLElement;
  await act(async () => {
    pack.focus();
    pack.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("while the pack is still sealed", () => {
  it("is the tearable pack and nothing else", () => {
    const { container } = renderOpening();
    expect(screen.getByRole("button", { name: /tear the pack open/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /skip/i })).not.toBeInTheDocument();
    expect(container.querySelectorAll('[data-testid="opening-card"]')).toHaveLength(0);
  });
});

describe("the ceremony", () => {
  it("deals the pack the moment the rip commits, not when the animation ends", async () => {
    const { container, onTear, onDone } = renderOpening();
    await tearAndRun(container, 0);
    expect(onTear).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
  });

  // The pack stops being a control the instant it stops being tearable. Every
  // e2e test in journeys.spec reads the absence of this role to mean "opened".
  it("stops being a button once it is opening", async () => {
    const { container } = renderOpening();
    await tearAndRun(container, 10);
    expect(screen.queryByRole("button", { name: /tear the pack open/i })).not.toBeInTheDocument();
    expect(container.querySelector('[aria-label="Tear the pack open"]')).toBeNull();
  });

  it("flies out one card per slot", async () => {
    const { container } = renderOpening({ slots: 3 });
    await tearAndRun(container, CEREMONY_START.launch);
    expect(container.querySelectorAll('[data-testid="opening-card"]')).toHaveLength(3);
  });
});

/**
 * The pack is genuinely four cards on a day with a drop in it, so the fan holds
 * four. What it must not do is give the card away: the face is the same universal
 * back the other three are showing, and the only tell is the rainbow bezel every
 * other secret surface in the app wears.
 */
describe("the daily secret in the fan", () => {
  it("takes a slot of its own, wearing the bezel", async () => {
    const { container } = renderOpening({ slots: 4, secret: true });
    await tearAndRun(container, CEREMONY_START.fan);

    const cards = container.querySelectorAll('[data-testid="opening-card"]');
    expect(cards).toHaveLength(4);
    // The last slot, matching the order the stand turns them in.
    expect(cards[3].querySelector(".holo-prism-edge")).not.toBeNull();
    for (const i of [0, 1, 2]) {
      expect(cards[i].querySelector(".holo-prism-edge")).toBeNull();
    }
  });

  it("is held in front of the roster while the fan is open", async () => {
    const { container } = renderOpening({ slots: 4, secret: true });
    await tearAndRun(container, CEREMONY_START.fan);

    const z = [...container.querySelectorAll<HTMLElement>('[data-testid="opening-card"]')].map(
      (el) => Number(el.style.zIndex),
    );
    expect(Math.max(...z)).toBe(z[3]);
  });

  // The stand turns the secret last, so the deck it is handed has to have the
  // secret at the bottom and the first roster card on top.
  it("drops to the back of the deck once the fan gathers", async () => {
    const { container } = renderOpening({ slots: 4, secret: true });
    await tearAndRun(container, CEREMONY_START.handoff);

    const z = [...container.querySelectorAll<HTMLElement>('[data-testid="opening-card"]')].map(
      (el) => Number(el.style.zIndex),
    );
    expect(Math.max(...z)).toBe(z[0]);
    expect(Math.min(...z)).toBe(z[3]);
  });

  it("gives nothing away that a roster card does not", async () => {
    const { container } = renderOpening({ slots: 4, secret: true });
    await tearAndRun(container, CEREMONY_START.fan);
    // No name, no art, no label — the ceremony knows nothing about which secret
    // it is and must not start pretending otherwise.
    expect(container.textContent).not.toMatch(/secret/i);
  });

  it("is absent on a day with no drop", async () => {
    const { container } = renderOpening({ slots: 3, secret: false });
    await tearAndRun(container, CEREMONY_START.fan);
    expect(container.querySelectorAll('[data-testid="opening-card"]')).toHaveLength(3);
    expect(container.querySelector(".holo-prism-edge")).toBeNull();
  });
});

describe("the ceremony, continued", () => {
  /**
   * There is a beat on arrival where the collection has not been reconciled, so
   * there is nothing to deal from and `tearOpen` refuses. A ceremony that started
   * anyway would play to an empty stage and — because it is torn once and only
   * once — leave the pack un-tearable for the rest of the day.
   */
  it("stays sealed and tearable when there was nothing to deal", async () => {
    const onTear = vi.fn(() => false);
    const { container } = renderOpening({ onTear });
    await tearAndRun(container, 400);

    expect(onTear).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll('[data-testid="opening-card"]')).toHaveLength(0);
    expect(screen.getByRole("button", { name: /tear the pack open/i })).toBeInTheDocument();

    // And once the pack is dealable, the very next attempt opens it.
    onTear.mockReturnValue(true);
    await tearAndRun(container, 10);
    expect(onTear).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: /tear the pack open/i })).not.toBeInTheDocument();
  });

  it("hands over to the stand when the clock runs out, and only then", async () => {
    const { container, onDone } = renderOpening();
    await tearAndRun(container, CEREMONY_MS - 50);
    expect(onDone).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(60);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

describe("skipping", () => {
  it("cuts straight to the stand", async () => {
    const { container, onDone } = renderOpening();
    await tearAndRun(container, 400);

    await act(async () => {
      screen.getByRole("button", { name: /skip/i }).click();
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  // A rip commits mid-drag with a finger still down. Skipping a ceremony nobody
  // has seen a frame of is worse than a dead zone nobody notices.
  it("ignores a tap in the first moments, while the finger is still on the pack", async () => {
    const { container, onDone } = renderOpening();
    await tearAndRun(container, 0);

    await act(async () => {
      screen.getByRole("button", { name: /skip/i }).click();
    });
    expect(onDone).not.toHaveBeenCalled();
  });

  it("hands over exactly once, however many ways it is ended", async () => {
    const { container, onDone } = renderOpening();
    await tearAndRun(container, 400);

    const skip = screen.getByRole("button", { name: /skip/i });
    await act(async () => {
      skip.click();
      skip.click();
    });
    // And the clock that was still running must not fire a second handover.
    await act(async () => {
      vi.advanceTimersByTime(CEREMONY_MS);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

describe("reduced motion", () => {
  it("skips the whole production and hands straight over", async () => {
    setMatchMedia((q) => q.includes("reduce"));
    const { container, onDone } = renderOpening();
    // The hook reads the preference in an effect, so the first paint is always
    // unreduced — flushing effects is what settles it.
    await act(async () => {});
    await tearAndRun(container, 0);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

/**
 * The single most valuable assertion in this file.
 *
 * `e2e/journeys.spec.ts` finds the card on the reveal stand with
 * `[role="button"][aria-pressed]`, taking `.first()`. Anything the ceremony puts
 * on the page carrying both attributes silently breaks ten specs at once, with
 * failures that read like stand bugs. This catches it in 200ms instead.
 */
describe("the selector the e2e suite depends on", () => {
  it("matches nothing the ceremony renders, at any point in the run", async () => {
    const { container } = renderOpening();
    expect(container.querySelector('[role="button"][aria-pressed]')).toBeNull();

    await tearAndRun(container, 0);
    let at = 0;
    for (const ms of [CEREMONY_START.peel, CEREMONY_START.fan, CEREMONY_START.handoff]) {
      await act(async () => {
        vi.advanceTimersByTime(ms - at);
      });
      at = ms;
      expect(container.querySelector('[role="button"][aria-pressed]')).toBeNull();
    }
  });
});
