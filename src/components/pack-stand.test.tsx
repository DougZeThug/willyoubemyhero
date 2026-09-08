// The reveal stand's contract with the ceremony that hands it the pack.
//
// The flight itself is not testable here — motion does not tick in jsdom, and
// pinning transform strings would be a test of the tuning rather than of the
// behaviour. What is worth pinning is what the flight must never do: put a card
// on screen that answers a tap before the stand actually owns it, and strand the
// route waiting for a landing that can never come. And, now that a secret can
// sit in any slot, that the stand treats it as a step like any other while
// still giving it the room it is owed.
import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PackStand, type StandSlot } from "./pack-stand";
import { rarityStyle } from "@/lib/card-rarity";
import type { PackHandoff } from "@/lib/pack-handoff";
import type { PackRosterSlot, PackSecretSlot } from "@/lib/pack";
import { playEditionShine } from "@/lib/card-sfx";
import { setMatchMedia } from "@/test/setup";

// jsdom has no canvas, and canvas-confetti walks straight into a null 2d
// context and throws. It is lazily imported, so it only actually runs once a
// test yields long enough for the dynamic import to settle. Nothing here is a
// test of the confetti.
vi.mock("@/lib/card-confetti", () => ({
  burst: vi.fn(async () => {}),
  celebrate: vi.fn(async () => {}),
  celebrateSecret: vi.fn(async () => {}),
  celebrateUpgrade: vi.fn(async () => {}),
}));

// The stand owns the finish's second cue now, so what it plays and *when* is part
// of this file's contract rather than an implementation detail of the route.
// `playFlip` is in here because HoloCard reaches for it on every turn; a partial
// mock would hand it undefined the first time a card moved.
vi.mock("@/lib/card-sfx", () => ({
  cue: vi.fn(),
  playEditionShine: vi.fn(),
  playFlip: vi.fn(),
}));

const PACK = [
  { id: "ep-1", participant_id: "p-1", running_order: 1, bib_number: 1, selected_draft_position: null, participant: { name: "Alice Ace" } }, // prettier-ignore
  { id: "ep-2", participant_id: "p-2", running_order: 2, bib_number: 2, selected_draft_position: null, participant: { name: "Bob Blitz" } }, // prettier-ignore
  { id: "ep-3", participant_id: "p-3", running_order: 3, bib_number: 3, selected_draft_position: null, participant: { name: "Carol Crush" } }, // prettier-ignore
];

/** A roster slot, resolved the way the route resolves one. */
function roster(
  i: number,
  over: Omit<Partial<StandSlot>, "slot"> & { slot?: Partial<PackRosterSlot> } = {},
): StandSlot {
  const ep = PACK[i];
  const { slot, ...rest } = over;
  return {
    slot: {
      kind: "roster",
      id: ep.id,
      edition: "standard",
      heldBefore: 0,
      editionBefore: null,
      ...slot,
    },
    rarity: rarityStyle("base"),
    // Null is "not decided", which is what a route with no answer yet passes.
    edition: slot?.edition === undefined ? null : slot.edition,
    outcome: "duplicate",
    copies: null,
    sellValue: null,
    ep,
    ...rest,
  };
}

/** A secret slot, dealt into the pack. */
function secret(
  over: Omit<Partial<StandSlot>, "slot"> & { slot?: Partial<PackSecretSlot> } = {},
): StandSlot {
  const { slot, ...rest } = over;
  return {
    slot: {
      kind: "secret",
      id: "sec-1",
      // Spelled out rather than left to `toSecretTier`'s fallback: now that the
      // level decides whether the card gets a second beat, the fixture has to
      // say which level it is testing.
      card: { id: "sec-1", name: "Pickles", flavour: null, foil: "rosette", borderFx: "spin", collection: null, artUrl: null, backUrl: null, tier: "common" }, // prettier-ignore
      duplicate: false,
      tierBefore: null,
      completedCollection: null,
      ...slot,
    },
    rarity: rarityStyle("base"),
    edition: null,
    outcome: "new",
    copies: 1,
    sellValue: null,
    ep: null,
    ...rest,
  };
}

const THREE = [roster(0), roster(1), roster(2)];

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
      slots={THREE}
      bundle={null}
      cursor={0}
      cards={undefined}
      revealed={[]}
      universalBack={null}
      pullCounts={undefined}
      peeking={false}
      busy={false}
      onEntered={onEntered}
      onReveal={() => {}}
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

describe("landing with nothing to catch", () => {
  it("never leaves the route waiting for a landing that cannot happen", () => {
    // A slot with no layout — jsdom, a skip, reduced motion — must still report
    // in, or the route holds `entering` forever, "Reveal all" stays disabled for
    // the rest of the pack and the deck of backs is pinned over the screen.
    const { onEntered } = renderStand({ enteringFrom: MEASURED });
    expect(onEntered).toHaveBeenCalledTimes(1);
  });
});

/**
 * A secret in its slot.
 *
 * It used to be a fourth card with a fake ending in front of it, which only
 * worked because it was always last. Now it can be anywhere, so what is pinned
 * is that the stand steps onto it like any other card — same heading, same
 * dots — and that everything the card itself is owed still arrives.
 */
describe("a secret in its slot", () => {
  const withSecretSecond = (over: Partial<React.ComponentProps<typeof PackStand>> = {}) =>
    renderStand({ slots: [roster(0), secret(), roster(2)], cursor: 1, ...over });

  it("counts as an ordinary step in the heading and the dots", () => {
    withSecretSecond();
    expect(screen.getByTestId("stand-step")).toHaveTextContent("2 / 3");
    expect(screen.queryByText(/one more card|pack complete/i)).toBeNull();
  });

  it("wears the breathing ring while face-down, and drops it once turned", () => {
    const { container, rerender } = withSecretSecond();
    expect(container.querySelector(".secret-seal")).not.toBeNull();
    rerender(
      <PackStand
        slots={[roster(0), secret(), roster(2)]}
        bundle={null}
        cursor={1}
        cards={undefined}
        revealed={[1]}
        universalBack={null}
        pullCounts={undefined}
        peeking={false}
        busy={false}
        onReveal={() => {}}
        onAdvance={() => {}}
      />,
    );
    expect(container.querySelector(".secret-seal")).toBeNull();
  });

  it("says what a secret is, before it is turned", () => {
    withSecretSecond();
    expect(screen.getByText(/not on the roster/i)).toBeInTheDocument();
  });

  it("never puts a finish on a secret", () => {
    // The reciprocal of the rule that no earned tier wears the prism ring: a
    // secret carries the ring and never an edition frame.
    const { container } = withSecretSecond({
      slots: [roster(0), secret({ edition: "platinum" }), roster(2)],
      revealed: [1],
    });
    expect(container.querySelector(".card-edition")).toBeNull();
  });

  it("shimmers a plain duplicate and not an upgrade", () => {
    const { container, rerender } = withSecretSecond({
      slots: [roster(0), secret({ outcome: "duplicate", copies: 2, slot: { duplicate: true } }), roster(2)], // prettier-ignore
      revealed: [1],
    });
    expect(container.querySelector(".secret-dupe-shimmer")).not.toBeNull();
    rerender(
      <PackStand
        slots={[roster(0), secret({ outcome: "upgrade", copies: 2, slot: { duplicate: true, tierBefore: "common" } }), roster(2)]} // prettier-ignore
        bundle={null}
        cursor={1}
        cards={undefined}
        revealed={[1]}
        universalBack={null}
        pullCounts={undefined}
        peeking={false}
        busy={false}
        onReveal={() => {}}
        onAdvance={() => {}}
      />,
    );
    expect(container.querySelector(".secret-dupe-shimmer")).toBeNull();
  });

  it("holds on 'Something else…' while it peeks", () => {
    withSecretSecond({ peeking: true });
    expect(screen.getByText("Something else…")).toBeInTheDocument();
  });
});

describe("the peek line", () => {
  it("promises a new card, or a better one", () => {
    renderStand({ slots: [roster(0, { outcome: "new" })], peeking: true });
    expect(screen.getByText("New card…")).toBeInTheDocument();
  });

  it("says a better copy is coming", () => {
    renderStand({ slots: [roster(0, { outcome: "upgrade" })], peeking: true });
    expect(screen.getByText("Better than yours…")).toBeInTheDocument();
  });
});

describe("the level on the stand", () => {
  const onSecret = { slots: [secret()], cursor: 0, revealed: [0] };

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
    renderStand({
      slots: [secret({ outcome: "duplicate", copies: 2, slot: { duplicate: true } })],
      cursor: 0,
      revealed: [0],
    });
    expect(screen.getByText(/already yours/i)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /^Common, \d of \d$/ })).toBeInTheDocument();
  });

  it("keeps the level line on an upgrade", () => {
    renderStand({
      slots: [secret({ outcome: "upgrade", copies: 2, slot: { duplicate: true, tierBefore: "common" } })], // prettier-ignore
      cursor: 0,
      revealed: [0],
    });
    expect(screen.queryByText(/already yours/i)).toBeNull();
    expect(screen.getByText(/0\.5% pull|common ·/i)).toBeInTheDocument();
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
    renderStand({ slots: [roster(0, { slot: { edition: "platinum" } })] });
    expect(chips(/^Platinum$/i)).toHaveLength(0);
  });

  it("names the finish once the card is revealed", () => {
    renderStand({ slots: [roster(0, { slot: { edition: "platinum" } })], revealed: [0] });
    expect(chips(/^Platinum$/i)).toHaveLength(1);
  });

  it("says nothing at all for a standard finish", () => {
    renderStand({ slots: [roster(0, { slot: { edition: "standard" } })], revealed: [0] });
    expect(chips(/^(Platinum|Gold|Silver|Bronze)$/i)).toHaveLength(0);
  });

  it("reads the finish for the card actually on the stand", () => {
    renderStand({
      slots: [roster(0, { slot: { edition: "platinum" } }), roster(1, { slot: { edition: "bronze" } })], // prettier-ignore
      cursor: 1,
      revealed: [1],
    });
    expect(chips(/^Bronze$/i)).toHaveLength(1);
    expect(chips(/^Platinum$/i)).toHaveLength(0);
  });

  it("renders a standard card for a finish the server has not decided", () => {
    renderStand({ revealed: [0] });
    expect(chips(/^(Platinum|Gold|Silver|Bronze)$/i)).toHaveLength(0);
    expect(screen.getByRole("button", { name: /alice ace/i })).toBeInTheDocument();
  });
});

/**
 * The beat between "it's Bob" and "…in Gold".
 *
 * A special pull lands on a face held at 60% for a quarter of a second before its
 * metal comes up, and a common one keeps the single beat it always had. What is
 * pinned here is which pulls earn the hold and when the finish's cue lands —
 * never the tuning, which belongs to the tokens and not to a test.
 *
 * Real timers: the hold is released by a timeout and let go by a motion exit,
 * and neither ticks under a fake clock.
 */
describe("the second beat", () => {
  const tick = (ms: number) =>
    act(async () => {
      await new Promise((r) => setTimeout(r, ms));
    });

  /** The held light. aria-hidden, so a test id is the only honest handle on it. */
  const held = () => screen.queryByTestId("reveal-beat");

  /** Long enough for the hold, the release and the fade that follows it. */
  const gone = () => waitFor(() => expect(held()).toBeNull(), { timeout: 4000 });

  it("holds a gold pull dim, then blooms it with its own cue", async () => {
    renderStand({ slots: [roster(0, { slot: { edition: "gold" } })], revealed: [0] });

    // The card is on screen and the finish is not yet: that gap is the point.
    expect(held()).not.toBeNull();
    expect(playEditionShine).not.toHaveBeenCalled();

    await waitFor(() => expect(playEditionShine).toHaveBeenCalledWith("gold"), { timeout: 4000 });
    await gone();
  });

  it("gives a standard pull the single beat it always had", async () => {
    renderStand({ slots: [roster(0, { slot: { edition: "standard" } })], revealed: [0] });
    expect(held()).toBeNull();
    await tick(900);
    expect(held()).toBeNull();
    expect(playEditionShine).not.toHaveBeenCalled();
  });

  it("holds nothing for a finish the server has not answered with", async () => {
    // The `known` guard. An unanswered finish reads as standard, and a beat spent
    // on the fallback is a promise about a card nobody has decided yet.
    renderStand({ revealed: [0] });
    await tick(900);
    expect(held()).toBeNull();
    expect(playEditionShine).not.toHaveBeenCalled();
  });

  it("still holds a champion the mint has not reached", () => {
    // The other half of that guard, and deliberately asymmetric: a champion is a
    // champion the moment the pack was dealt, so its ceremony must not depend on
    // how fast the network was.
    renderStand({ slots: [roster(0, { rarity: rarityStyle("champion") })], revealed: [0] });
    expect(held()).not.toBeNull();
  });

  it("has no dim and one beat when the device asks for less motion", async () => {
    setMatchMedia((q) => q.includes("prefers-reduced-motion"));
    renderStand({ slots: [roster(0, { slot: { edition: "gold" } })], revealed: [0] });

    // The cue is not a motion setting — see the note at the top of card-sfx.ts —
    // so it lands on the beat the card was turned rather than being dropped.
    expect(playEditionShine).toHaveBeenCalledWith("gold");
    await gone();
  });

  it("holds a Rare secret and leaves its bell where it was", async () => {
    // The secret's second beat is the ring blooming out of the flash, and nothing
    // else: its own chime rang at the top of the turn and its impact landed a beat
    // ago, so a fifth sound here would be noise rather than a second beat.
    renderStand({
      slots: [secret({ slot: { card: { ...(secret().slot as PackSecretSlot).card, tier: "rare" } } })], // prettier-ignore
      cursor: 0,
      revealed: [0],
    });
    expect(held()).not.toBeNull();
    await gone();
    expect(playEditionShine).not.toHaveBeenCalled();
  });

  it("gives a Common secret the single beat", async () => {
    renderStand({ slots: [secret()], cursor: 0, revealed: [0] });
    await tick(900);
    expect(held()).toBeNull();
  });
});

/**
 * Whether the pull is new, better than yours, or another one.
 *
 * `getByRole("img")` rather than the text: the glyph is aria-hidden and the label
 * is the thing a person standing in a garden with VoiceOver on actually gets.
 */
describe("the NEW / ×N / ↑ ribbon", () => {
  /**
   * The stamp, once the card has finished turning.
   *
   * Async because it genuinely is: the ribbon waits for `settled`, which lands a
   * flip after the tap (540ms for a roster card, 1140ms for a secret). The
   * budget clears both with room to spare.
   */
  const ribbon = (name: string | RegExp) => screen.findByRole("img", { name }, { timeout: 3000 });

  /** Real timers, for the same reason the beat above uses them. */
  const waitOutTheFlip = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 700));
    });

  it("says nothing at all before the card is turned", async () => {
    // Same rule the badge follows. A ribbon on a face-down card answers the
    // question the flip exists to ask.
    renderStand({ slots: [roster(0, { outcome: "new", copies: 1 })] });
    expect(screen.queryByRole("img", { name: /new card|you now hold/i })).toBeNull();
  });

  it("waits for the turn to finish rather than stamping a card edge-on", async () => {
    // `isRevealed` goes true on the tap, half a second before there is a face to
    // read. A ribbon that followed it announced the answer over a card still
    // rotating — the same beat the badge deliberately waits out.
    renderStand({ slots: [roster(0, { copies: 3 })], revealed: [0] });
    expect(screen.queryByRole("img", { name: /you now hold/i })).toBeNull();
    expect(await ribbon("You now hold 3 of this card")).toBeInTheDocument();
  });

  it("calls a roster card held zero times NEW", async () => {
    renderStand({ slots: [roster(0, { outcome: "new", copies: 1 })], revealed: [0] });
    expect(await ribbon("New card")).toBeInTheDocument();
  });

  it("counts a roster card already held twice as the third copy", async () => {
    renderStand({ slots: [roster(0, { copies: 3 })], revealed: [0] });
    expect(await ribbon("You now hold 3 of this card")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "New card" })).toBeNull();
  });

  it("names the rung a better copy climbed to", async () => {
    renderStand({
      slots: [roster(0, { outcome: "upgrade", copies: 2, slot: { edition: "gold" } })],
      revealed: [0],
    });
    expect(await ribbon(/^Upgraded to Gold/)).toHaveTextContent("↑ Gold");
  });

  it("reads the count for the card actually on the stand", async () => {
    renderStand({
      slots: [roster(0, { copies: 4 }), roster(1, { outcome: "new", copies: 1 })],
      cursor: 1,
      revealed: [1],
    });
    expect(await ribbon("New card")).toBeInTheDocument();
  });

  it("shows nothing for a card the route could not count", async () => {
    // Silence beats a guess: assuming 1 here would stamp NEW on a card this
    // component knows nothing about.
    renderStand({ revealed: [0] });
    await waitOutTheFlip();
    expect(screen.queryByRole("img", { name: /new card|you now hold/i })).toBeNull();
  });

  it("calls a secret that is not a duplicate NEW", async () => {
    renderStand({ slots: [secret()], cursor: 0, revealed: [0] });
    expect(await ribbon("New card")).toBeInTheDocument();
  });

  it("counts a duplicate secret", async () => {
    renderStand({
      slots: [secret({ outcome: "duplicate", copies: 2, slot: { duplicate: true } })],
      cursor: 0,
      revealed: [0],
    });
    expect(await ribbon("You now hold 2 of this card")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "New card" })).toBeNull();
  });

  it("names the level an upgraded secret climbed to", async () => {
    renderStand({
      slots: [secret({ outcome: "upgrade", copies: 2, slot: { duplicate: true, tierBefore: "common" } })], // prettier-ignore
      cursor: 0,
      revealed: [0],
    });
    expect(await ribbon(/^Upgraded to Common/)).toBeInTheDocument();
  });
});

/** The spare copy is worth something, and this is where that is said. */
describe("the sell hint", () => {
  const worth = () =>
    screen.queryAllByText(/^Sell for \d+$/).filter((el) => !el.closest(".sr-only"));

  it("offers a price for a spare when dust is on", () => {
    renderStand({ slots: [roster(0, { copies: 2, sellValue: 40 })], revealed: [0] });
    expect(worth()).toHaveLength(1);
    expect(worth()[0]).toHaveTextContent("Sell for 40");
  });

  it("prices a duplicate secret beside the wink", () => {
    renderStand({
      slots: [secret({ outcome: "duplicate", copies: 2, sellValue: 30, slot: { duplicate: true } })], // prettier-ignore
      cursor: 0,
      revealed: [0],
    });
    expect(worth()[0]).toHaveTextContent("Sell for 30");
  });

  it("stays quiet when the route offers no price", () => {
    // Which covers all three of the route's gates at once — a first copy, a
    // guest, and dust switched off all arrive here as null.
    renderStand({ slots: [roster(0, { outcome: "new", copies: 1 })], revealed: [0] });
    expect(worth()).toHaveLength(0);
  });
});
