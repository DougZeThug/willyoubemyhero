// The reveal stand's contract with the ceremony that hands it the pack.
//
// The flight itself is not testable here — motion does not tick in jsdom, and
// pinning transform strings would be a test of the tuning rather than of the
// behaviour. What is worth pinning is what the flight must never do: put a card
// on screen that answers a tap before the stand actually owns it, and strand the
// route waiting for a landing that can never come.
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PackStand } from "./pack-stand";
import { rarityStyle } from "@/lib/card-rarity";
import type { PackHandoff } from "@/lib/pack-handoff";

const PACK = [
  { id: "ep-1", participant_id: "p-1", running_order: 1, bib_number: 1, selected_draft_position: null, participant: { name: "Alice Ace" } }, // prettier-ignore
  { id: "ep-2", participant_id: "p-2", running_order: 2, bib_number: 2, selected_draft_position: null, participant: { name: "Bob Blitz" } }, // prettier-ignore
  { id: "ep-3", participant_id: "p-3", running_order: 3, bib_number: 3, selected_draft_position: null, participant: { name: "Carol Crush" } }, // prettier-ignore
];

/** A deck that was genuinely measured — what a real browser would hand over. */
const MEASURED: PackHandoff = {
  w: 187,
  cards: [
    { cx: 160, cy: 420 },
    { cx: 164, cy: 426 },
    { cx: 168, cy: 432 },
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
    const flying = container.querySelectorAll('[aria-hidden="true"] .rounded-xl');
    expect(flying.length).toBeGreaterThanOrEqual(MEASURED.cards.length);
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
