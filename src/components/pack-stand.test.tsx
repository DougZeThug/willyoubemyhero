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
      secretSellValue={null}
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
      secretSellValue: null,
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

  /**
   * The signal the automatic run waits on.
   *
   * "Reveal all" has to turn the secret over, and it cannot know when the stand
   * has finished handing the stage across — that ends on an animation callback,
   * with a long fallback behind it for a backgrounded tab. Guessing a delay
   * against it is a race the run loses by finishing without ever showing the
   * card, so the stand says so instead. Once per arrival, and not before the
   * card is actually there.
   */
  it("tells the route when the fourth card is on the stand, and not before", async () => {
    const onSecretStaged = vi.fn();
    stepToSecret({ onSecretStaged });
    expect(onSecretStaged).not.toHaveBeenCalled();

    await watchTheTwist(() => {
      // Never announced while a roster card still owns the stage.
      if (screen.queryByRole("button", { name: /carol crush/i })) {
        expect(onSecretStaged).not.toHaveBeenCalled();
      }
    });

    expect(onSecretStaged).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /pickles/i })).toBeInTheDocument();

    // And not again on every render that follows it.
    for (let i = 0; i < 5; i++) await tick(120);
    expect(onSecretStaged).toHaveBeenCalledTimes(1);
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

describe("the level on the stand", () => {
  /** The stand, on the secret's step, with the card turned over. */
  const onSecret = {
    secretSlot: "open" as const,
    secret: SECRET,
    secretRevealed: true,
    cursor: PACK.length,
  };

  it("announces the level beside the pips on a fresh pull", () => {
    // The caption says it in words, so the pips only add the rank. Saying both
    // would read "Mythic, 5 of 5" and then "Mythic · 0.5% pull" to a screen
    // reader — the same word twice, one node apart.
    renderStand(onSecret);
    expect(screen.getByRole("img", { name: /^Level \d of \d$/ })).toBeInTheDocument();
  });

  it("still names the level when a duplicate replaces the caption", () => {
    // The regression this pins: on a duplicate the caption becomes "Already
    // yours — this one's just showing off", which never says the level. With
    // the pips announcing only a rank, the one moment the level is decided
    // became the one place a screen reader could not hear it.
    renderStand({ ...onSecret, secretDuplicate: true });
    expect(screen.getByText(/already yours/i)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /^Common, \d of \d$/ })).toBeInTheDocument();
  });
});

describe("the finish on the stand", () => {
  /**
   * The printed chip only, excluding HoloCard's own sr-only title.
   *
   * That title names the tier on a face-down card too, and always has — the
   * stand mounts the real rarity before the turn so the art is decoded in time.
   * Extending it to the finish keeps the two axes consistent rather than giving
   * the edition a rule the tier does not follow; what is asserted here is the
   * visible badge, which is the thing the ceremony is actually withholding.
   */
  const chips = (pattern: RegExp) =>
    screen.queryAllByText(pattern).filter((el) => !el.closest(".sr-only"));

  it("prints no badge before the card is turned over", () => {
    // The whole reason a pack is worth opening. A badge on a face-down card
    // spends the reveal before it happens.
    renderStand({ editions: { "ep-1": "platinum" } });
    expect(chips(/^Platinum$/i)).toHaveLength(0);
  });

  it("names the finish once the card is revealed", () => {
    renderStand({ editions: { "ep-1": "platinum" }, revealed: [0] });
    expect(chips(/^Platinum$/i)).toHaveLength(1);
  });

  it("says nothing at all for a standard finish", () => {
    renderStand({ editions: { "ep-1": "standard" }, revealed: [0] });
    expect(chips(/^(Platinum|Gold|Silver|Bronze)$/i)).toHaveLength(0);
  });

  it("reads the finish for the card actually on the stand", () => {
    // Keyed by card id, not by cursor position — the pity swap means slot order
    // and card identity are not the same thing.
    renderStand({ cursor: 1, revealed: [1], editions: { "ep-1": "platinum", "ep-2": "bronze" } });
    expect(chips(/^Bronze$/i)).toHaveLength(1);
    expect(chips(/^Platinum$/i)).toHaveLength(0);
  });

  it("renders standard cards for a caller that passes no finishes at all", () => {
    renderStand({ revealed: [0] });
    expect(chips(/^(Platinum|Gold|Silver|Bronze)$/i)).toHaveLength(0);
    expect(screen.getByRole("button", { name: /alice ace/i })).toBeInTheDocument();
  });

  it("never puts a finish on the secret", () => {
    // The reciprocal of the rule that no earned tier wears the prism ring: a
    // secret carries the ring and never an edition frame.
    const { container } = renderStand({
      cursor: 3,
      secretSlot: "sealed",
      secret: SECRET,
      secretRevealed: true,
      editions: { "sec-1": "platinum", "ep-1": "platinum" },
    });
    expect(chips(/^(Platinum|Gold|Silver|Bronze)$/i)).toHaveLength(0);
    expect(container.querySelector(".card-edition")).toBeNull();
  });
});

/**
 * Whether the pull is new, which the stand never used to say for a roster card.
 *
 * Two predicates, because the data lives in two places: a roster card's count
 * comes from the snapshot the pack was dealt against, and the secret's from the
 * pull's own duplicate flag. Both arrive here as one number, so what is pinned
 * is the sentence the number turns into.
 *
 * `getByRole("img")` rather than the text: the glyph is aria-hidden and the label
 * is the thing a person standing in a garden with VoiceOver on actually gets.
 */
describe("the NEW / ×N ribbon", () => {
  /** The stand parked on the secret, without waiting out the twist to get there. */
  const atSecret = (over: Partial<React.ComponentProps<typeof PackStand>> = {}) =>
    renderStand({
      cursor: PACK.length,
      secretSlot: "open",
      secret: SECRET,
      secretRevealed: true,
      ...over,
    });

  it("says nothing at all before the card is turned", () => {
    // Same rule the badge follows. A ribbon on a face-down card answers the
    // question the flip exists to ask.
    renderStand({ copies: { "ep-1": 1 } });
    expect(screen.queryByRole("img", { name: /new card|you now hold/i })).toBeNull();
  });

  it("calls a roster card held zero times NEW", () => {
    renderStand({ revealed: [0], copies: { "ep-1": 1 } });
    expect(screen.getByRole("img", { name: "New card" })).toBeInTheDocument();
  });

  it("counts a roster card already held twice as the third copy", () => {
    // held === 2 at deal time, so the card in your hand is the third.
    renderStand({ revealed: [0], copies: { "ep-1": 3 } });
    expect(screen.getByRole("img", { name: "You now hold 3 of this card" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "New card" })).toBeNull();
  });

  it("reads the count for the card actually on the stand", () => {
    // Keyed by card id rather than cursor position, for the same reason the
    // finish is: the pity swap makes slot order and card identity different
    // things.
    renderStand({ cursor: 1, revealed: [1], copies: { "ep-1": 4, "ep-2": 1 } });
    expect(screen.getByRole("img", { name: "New card" })).toBeInTheDocument();
  });

  it("shows nothing for a card the caller could not count", () => {
    // Silence beats a guess: assuming 1 here would stamp NEW on a card this
    // component knows nothing about.
    renderStand({ revealed: [0], copies: {} });
    expect(screen.queryByRole("img", { name: /new card|you now hold/i })).toBeNull();
  });

  it("calls a secret that is not a duplicate NEW", () => {
    atSecret({ secretDuplicate: false, secretCopies: 1 });
    expect(screen.getByRole("img", { name: "New card" })).toBeInTheDocument();
  });

  it("counts a duplicate secret", () => {
    atSecret({ secretDuplicate: true, secretCopies: 2 });
    expect(screen.getByRole("img", { name: "You now hold 2 of this card" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "New card" })).toBeNull();
  });
});

/** The spare roster copy is worth something, and this is where that is said. */
describe("the roster sell hint", () => {
  const worth = () =>
    screen.queryAllByText(/^Sell for \d+$/).filter((el) => !el.closest(".sr-only"));

  it("offers a price for a spare when dust is on", () => {
    renderStand({ revealed: [0], copies: { "ep-1": 2 }, sellValues: { "ep-1": 40 } });
    expect(worth()).toHaveLength(1);
    expect(worth()[0]).toHaveTextContent("Sell for 40");
  });

  it("stays quiet when the route offers no price", () => {
    // Which covers all three of the route's gates at once — a first copy, a
    // guest, and dust switched off all arrive here as an empty map.
    renderStand({ revealed: [0], copies: { "ep-1": 1 }, sellValues: {} });
    expect(worth()).toHaveLength(0);
  });
});
