// The reveal stand's contract with the ceremony that hands it the pack.
//
// The flight itself is not testable here — motion does not tick in jsdom, and
// pinning transform strings would be a test of the tuning rather than of the
// behaviour. What is worth pinning is what the flight must never do: put a card
// on screen that answers a tap before the stand actually owns it, and strand the
// route waiting for a landing that can never come.
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PackStand } from "./pack-stand";
import { rarityStyle } from "@/lib/card-rarity";
import type { PackHandoff } from "@/lib/pack-handoff";

// jsdom has no canvas, and canvas-confetti walks straight into a null 2d
// context and throws. It is lazily imported, so it only actually runs once a
// test yields long enough for the dynamic import to settle — which the phase
// walk below does. Nothing here is a test of the confetti.
vi.mock("@/lib/card-confetti", () => ({
  burst: vi.fn(async () => {}),
  celebrate: vi.fn(async () => {}),
  celebrateSecret: vi.fn(async () => {}),
}));

const PACK = [
  { id: "ep-1", participant_id: "p-1", running_order: 1, bib_number: 1, selected_draft_position: null, participant: { name: "Alice Ace" } }, // prettier-ignore
  { id: "ep-2", participant_id: "p-2", running_order: 2, bib_number: 2, selected_draft_position: null, participant: { name: "Bob Blitz" } }, // prettier-ignore
  { id: "ep-3", participant_id: "p-3", running_order: 3, bib_number: 3, selected_draft_position: null, participant: { name: "Carol Crush" } }, // prettier-ignore
];

/** The daily secret, once its pull has landed. */
const SECRET = {
  id: "sec-1",
  name: "Pickles",
  artUrl: null,
  foil: null,
  borderFx: null,
} as unknown as React.ComponentProps<typeof PackStand>["secret"];

/** A deck that was genuinely measured — what a real browser would hand over. */
const MEASURED: PackHandoff = {
  w: 187,
  cards: [
    { cx: 160, cy: 420, w: 187, rotate: 0 },
    { cx: 164, cy: 426, w: 184, rotate: 1.1 },
    { cx: 168, cy: 432, w: 181, rotate: 2.2 },
  ],
};

function renderStand(over: Partial<React.ComponentProps<typeof PackStand>> = {}) {
  const onEntered = vi.fn();
  const view = render(
    <PackStand
      pack={PACK}
      bundle={null}
      cursor={0}
      cards={undefined}
      rarities={new Map()}
      revealed={[]}
      universalBack={null}
      pullCounts={undefined}
      secretSlot="hidden"
      secret={null}
      secretRarity={rarityStyle("base")}
      secretRevealed={false}
      secretDuplicate={false}
      secretPeeking={false}
      peeking={false}
      busy={false}
      onEntered={onEntered}
      onReveal={() => {}}
      onRevealSecret={() => {}}
      onAdvance={() => {}}
      {...over}
    />,
  );
  return { ...view, onEntered };
}

describe("mounting without a ceremony behind it", () => {
  it("shows the card straight away and reports nothing to land", () => {
    // A resumed pack, a skipped ceremony, or reduced motion. All of them mount
    // the stand with no geometry, and all of them must simply be a card.
    const { onEntered } = renderStand();
    expect(screen.getByRole("button", { name: /alice ace/i })).toBeInTheDocument();
    expect(onEntered).toHaveBeenCalledTimes(1);
  });

  it("says which card of how many, for the suite that drives the sequence", () => {
    renderStand();
    expect(screen.getByTestId("stand-step")).toHaveTextContent("1 / 3");
  });
});

/**
 * The single most valuable assertion in this file.
 *
 * `e2e/journeys.spec.ts` finds the card on the stand with
 * `[role="button"][aria-pressed]`, taking `.first()`. HoloCard derives `canFlip`
 * from having a back — which the stand always gives it — so it carries
 * `aria-pressed` whatever else is done to it. If the landing ever stopped hiding
 * it, or the flying cards were ever swapped for real HoloCards, the suite would
 * start clicking a card that is still travelling.
 */
describe("while the deck is still landing", () => {
  /**
   * jsdom measures every element as zero, which makes `canFly` refuse and the
   * landing path never run at all — so a test that simply passes geometry in
   * proves nothing. This gives the slot a real box, which is the only way to
   * exercise the branch this file is actually about.
   */
  function withLayout<T>(run: () => T): T {
    const real = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      return { left: 40, top: 200, width: 280, height: 392, right: 320, bottom: 592, x: 40, y: 200, toJSON: () => ({}) } as DOMRect; // prettier-ignore
    };
    try {
      return run();
    } finally {
      Element.prototype.getBoundingClientRect = real;
    }
  }

  it("holds the real card out of reach until the flight has landed", () => {
    const { container } = withLayout(() => renderStand({ enteringFrom: MEASURED }));

    // The card is mounted — its art has to be decoding while the deck is in the
    // air — but every tappable thing on screen is inside a hidden subtree, so
    // neither a thumb nor Playwright's actionability check can reach it.
    const tappable = container.querySelectorAll('[role="button"][aria-pressed]');
    expect(tappable.length).toBeGreaterThan(0);
    for (const el of tappable) {
      expect(el.closest(".invisible")).not.toBeNull();
    }
  });

  it("has not told the route it has landed yet", () => {
    const { onEntered } = withLayout(() => renderStand({ enteringFrom: MEASURED }));
    // motion does not tick here, so the flight never completes — which is the
    // point: `onEntered` must be driven by the animation finishing, not by the
    // stand merely having mounted.
    expect(onEntered).not.toHaveBeenCalled();
  });

  it("puts the flying deck on screen, and hides it from the reader", () => {
    const { container } = withLayout(() => renderStand({ enteringFrom: MEASURED }));
    // Three cards were handed over, so three fly. They are decoration — a screen
    // reader being told about them is being told about a camera move.
    // Scoped to the entrance itself. Counting every rounded card inside an
    // aria-hidden wrapper also swept up the *resting* deck, which is a different
    // component that is on screen at the same time — so the assertion passed
    // whether or not anything was actually flying.
    const flight = container.querySelector('[data-testid="stand-entrance"]')!;
    expect(flight).not.toBeNull();
    expect(flight.children.length).toBe(MEASURED.cards.length);
  });
});

/**
 * The fake ending.
 *
 * Every test here is about when it must *not* run. A twist is only a twist if the
 * thing it interrupts was believable, and every one of these cases is a way of
 * pretending the pack is over when it either already was or never will not be.
 */
describe("the fake ending", () => {
  /** The stand parked on the secret's slot, with the roster already turned. */
  function standProps(over: Partial<React.ComponentProps<typeof PackStand>> = {}) {
    return {
      pack: PACK,
      bundle: null,
      cursor: PACK.length,
      cards: undefined,
      rarities: new Map(),
      revealed: [0, 1, 2],
      universalBack: null,
      pullCounts: undefined,
      secretSlot: "sealed",
      secret: SECRET,
      secretRarity: rarityStyle("base"),
      secretRevealed: false,
      secretDuplicate: false,
      secretPeeking: false,
      peeking: false,
      busy: false,
      onReveal: () => {},
      onRevealSecret: () => {},
      onAdvance: () => {},
      ...over,
    } as React.ComponentProps<typeof PackStand>;
  }

  /**
   * Real timers, deliberately, for everything that watches the twist play.
   *
   * `clearing` ends when the card actually unmounts, which means motion has to
   * run — and motion drives itself off requestAnimationFrame. Faking that works
   * exactly once per file: cycling `useFakeTimers`/`useRealTimers` leaves the
   * frame loop holding a handle from a clock that no longer exists, so every
   * test after the first sees animations that never tick and a stand stuck
   * mid-handover. The twist is about a second and a half; waiting it out is far
   * cheaper than the false failures.
   */
  const tick = (ms: number) =>
    act(async () => {
      await new Promise((r) => setTimeout(r, ms));
    });

  /** The whole twist, sampled as it goes. `see` runs on every frame sampled. */
  async function watchTheTwist(see?: () => void, everyMs = 20, budgetMs = 6000) {
    for (let waited = 0; waited < budgetMs; waited += everyMs) {
      see?.();
      if (screen.getByTestId("stand-step").textContent?.match(/one more card/i)) return;
      await tick(everyMs);
    }
    throw new Error("the twist never reached the fourth card");
  }

  /** Walk from the last roster card onto the secret's slot, the way a swipe does. */
  function stepToSecret(over: Partial<React.ComponentProps<typeof PackStand>> = {}) {
    const view = renderStand({ cursor: PACK.length - 1, secretSlot: "sealed", ...over });
    view.rerender(<PackStand {...standProps(over)} />);
    return view;
  }

  it("says the pack is finished before it admits there is another card", () => {
    stepToSecret();
    expect(screen.getByTestId("stand-step")).toHaveTextContent(/pack complete/i);
    // And nothing about the fourth card is on screen yet — that line arriving
    // early is exactly what made the old heading swap not a surprise.
    expect(screen.queryByText(/one more card/i)).toBeNull();
  });

  /**
   * The pretence has to be believable, and a fourth card sitting on the stand
   * under a "Pack Complete" heading is not. Worse, it was tappable: its reveal
   * could be started before the twist had finished playing, which spends the
   * surprise on somebody who was simply quick with their thumb.
   *
   * So the card on screen during the pretence is the last roster card, exactly
   * as it was left. That is what a finished pack actually looks like.
   */
  it("keeps the last roster card on the stand rather than showing the fourth", () => {
    stepToSecret();
    // The card the sequence just finished with, still on the stand.
    expect(screen.getByRole("button", { name: /carol crush/i })).toBeInTheDocument();
    // And nothing on screen that is the fourth card.
    expect(screen.queryByRole("button", { name: /pickles/i })).toBeNull();
  });

  it("does not reveal the secret if the card is tapped mid-pretence", () => {
    const onRevealSecret = vi.fn();
    stepToSecret({ onRevealSecret });
    for (const el of screen.queryAllByRole("button")) el.click();
    expect(onRevealSecret).not.toHaveBeenCalled();
  });

  it("takes it back, and lands on the fourth card", async () => {
    stepToSecret();
    await watchTheTwist();
    expect(screen.getByTestId("stand-step")).toHaveTextContent(/one more card/i);
    expect(screen.getByRole("button", { name: /pickles/i })).toBeInTheDocument();
  });

  /**
   * The bug this whole machine was written for.
   *
   * `secretSlot` moves under the stand while the cursor is parked on the
   * secret's slot, and revealing the card is one of the moves: "sealed" becomes
   * "open". The effect this replaced had `secretSlot` in its dependency list and
   * no latch on it, so that re-ran the fake ending from the top — dropping the
   * secret and putting the last roster card back on screen over it for another
   * second and a half.
   *
   * Driven by hand rather than through "Reveal all" on purpose: the automatic
   * run sets `busy`, which skipped the pretence outright and is exactly why the
   * e2e suite never caught this.
   */
  it("does not replay the fake ending when the secret's slot changes under it", async () => {
    const view = stepToSecret();
    await watchTheTwist();

    // The card is turned over. `secretSlot` moves "sealed" to "open" for it, and
    // nothing about that is a fresh arrival.
    view.rerender(<PackStand {...standProps({ secretSlot: "open", secretRevealed: true })} />);
    expect(screen.getByTestId("stand-step")).toHaveTextContent(/one more card/i);
    expect(screen.queryByRole("button", { name: /carol crush/i })).toBeNull();

    // And it stays that way rather than sliding back into the pretence a beat
    // later, which is exactly what the old effect did.
    for (let i = 0; i < 10; i++) await tick(120);
    expect(screen.getByTestId("stand-step")).toHaveTextContent(/one more card/i);
    expect(screen.queryByRole("button", { name: /carol crush/i })).toBeNull();
  });

  /**
   * The overlap itself, sampled rather than argued about.
   *
   * `stand-phase.test.ts` proves the machine cannot express the state; this
   * proves the component is actually wired to it. Sampled every 20ms, which is
   * finer than any frame the handover has, so an exit that outlived its own
   * phase — what the old arrangement had — could not slip between two samples.
   */
  it("never has the last roster card on screen alongside the fourth", async () => {
    stepToSecret();
    await watchTheTwist(() => {
      const carol = screen.queryByRole("button", { name: /carol crush/i });
      const pickles = screen.queryByRole("button", { name: /pickles/i });
      expect(Boolean(carol && pickles)).toBe(false);
      // "One More Card" is the payoff line, and it belongs to a card. It must
      // never be on screen over the one before it.
      if (screen.getByTestId("stand-step").textContent?.match(/one more card/i)) {
        expect(carol).toBeNull();
      }
    });
  });

  /** The deliberate beat: for a moment there is no card on the stand at all. */
  it("clears the stage completely before the fourth card arrives", async () => {
    stepToSecret();
    let bareFrames = 0;
    await watchTheTwist(() => {
      if (screen.queryAllByRole("button", { name: /carol crush|pickles/i }).length === 0) {
        bareFrames++;
      }
    });
    expect(bareFrames).toBeGreaterThan(0);
  });

  /**
   * The case that matters most. A pull that failed, an empty set, or a guest who
   * never claimed all fall straight through to the columns — and a fake ending
   * followed by nothing at all is far worse than no fake ending.
   */
  it("does not pretend when there is no fourth card coming", () => {
    for (const slot of ["failed", "hidden", "gated"] as const) {
      const view = stepToSecret({ secretSlot: slot });
      expect(screen.getByTestId("stand-step")).not.toHaveTextContent(/pack complete/i);
      view.unmount();
    }
  });

  it("does not pretend for somebody who pressed Reveal all", () => {
    // They have said they want to get through this. A twist nobody chose to sit
    // through is a delay — and the run would turn the secret over while the
    // screen still said the pack was finished.
    stepToSecret({ busy: true });
    expect(screen.getByTestId("stand-step")).not.toHaveTextContent(/pack complete/i);
  });

  it("does not pretend for somebody coming back to a card they already knew about", () => {
    // Mounted straight onto the secret's slot — a reload, not a step. Replaying
    // the twist on arrival is a lie rather than a surprise.
    renderStand({ cursor: PACK.length, secretSlot: "sealed", secret: SECRET });
    expect(screen.getByTestId("stand-step")).not.toHaveTextContent(/pack complete/i);
  });
});

describe("landing with nothing to catch", () => {
  it("never leaves the route waiting for a landing that cannot happen", () => {
    // A slot with no layout — jsdom, a skip, reduced motion — must still report
    // in, or the route holds `entering` forever, "Reveal all" stays disabled for
    // the rest of the pack and the deck of backs is pinned over the screen.
    const { onEntered } = renderStand({ enteringFrom: MEASURED });
    expect(onEntered).toHaveBeenCalledTimes(1);
  });
});
