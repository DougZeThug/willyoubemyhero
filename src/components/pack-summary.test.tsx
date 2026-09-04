// Where the pack ends up, and what it says about what you just pulled.
//
// The summary is the curtain call: it is the only screen that lays all four
// cards out at once, and until the ribbons landed it was also the screen that
// said the least about them. What is pinned here is the sentence each card gets
// — new or not, and what a spare is worth — plus the two exits, because a
// payoff nobody can leave is not a payoff.
import { createElement, type ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PackSummary } from "./pack-summary";
import { rarityStyle } from "@/lib/card-rarity";

// PackSummary renders two <Link>s and there is no router under a unit test.
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...rest }: { children: React.ReactNode; to: string }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

// Motion does not tick in jsdom, and every assertion here is about what the
// markup says rather than how it arrives. Rendering the plain tags keeps a
// spring's settle out of the test entirely.
vi.mock("motion/react", () => ({
  motion: new Proxy(
    {},
    {
      get:
        (_, tag: string) =>
        ({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) =>
          createElement(tag, props, children),
    },
  ),
  AnimatePresence: ({ children }: { children?: ReactNode }) => children,
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
  tier: "rare",
} as unknown as React.ComponentProps<typeof PackSummary>["secret"];

function renderSummary(over: Partial<React.ComponentProps<typeof PackSummary>> = {}) {
  return render(
    <PackSummary
      pack={PACK}
      bundle={null}
      cards={undefined}
      rarities={new Map()}
      revealed={[0, 1, 2]}
      pullCounts={undefined}
      universalBack={null}
      secretSlot="hidden"
      secret={null}
      secretRarity={rarityStyle("base")}
      secretDuplicate={false}
      secretPulled={0}
      collected={3}
      total={13}
      eventYear={2026}
      streak={null}
      claimable={null}
      canClaim={false}
      claiming={false}
      claimError={null}
      onClaim={() => {}}
      onRetrySecret={() => {}}
      {...over}
    />,
  );
}

/** The stand parked on an open secret, which is the only slot that shows a card. */
const withSecret = (over: Partial<React.ComponentProps<typeof PackSummary>> = {}) =>
  renderSummary({ secretSlot: "open", secret: SECRET, ...over });

describe("the NEW / ×N ribbon", () => {
  it("calls a roster card held zero times NEW", () => {
    renderSummary({ copies: { "ep-1": 1, "ep-2": 1, "ep-3": 1 } });
    expect(screen.getAllByRole("img", { name: "New card" })).toHaveLength(3);
  });

  it("counts a roster card already held twice as the third copy", () => {
    // held === 2 at deal time, so the copy on this screen is the third.
    renderSummary({ copies: { "ep-1": 3, "ep-2": 1, "ep-3": 1 } });
    expect(screen.getByRole("img", { name: "You now hold 3 of this card" })).toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: "New card" })).toHaveLength(2);
  });

  it("says nothing over a card the sequence has not turned yet", () => {
    // A column still waiting on its reveal is a card mid-ceremony, and its
    // ribbon would answer ahead of the flip.
    renderSummary({ revealed: [], copies: { "ep-1": 1, "ep-2": 1, "ep-3": 1 } });
    expect(screen.queryByRole("img", { name: /new card|you now hold/i })).toBeNull();
  });

  it("shows nothing for a card the caller could not count", () => {
    // Silence beats a guess: assuming 1 would stamp NEW on a card this component
    // knows nothing about.
    renderSummary({ copies: {} });
    expect(screen.queryByRole("img", { name: /new card|you now hold/i })).toBeNull();
  });

  it("calls a secret that is not a duplicate NEW", () => {
    withSecret({ secretDuplicate: false, secretCopies: 1 });
    expect(screen.getByRole("img", { name: "New card" })).toBeInTheDocument();
  });

  it("counts a duplicate secret", () => {
    withSecret({ secretDuplicate: true, secretCopies: 2 });
    expect(screen.getByRole("img", { name: "You now hold 2 of this card" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "New card" })).toBeNull();
  });
});

describe("what a spare is worth", () => {
  const worth = () =>
    screen.queryAllByText(/^Sell for \d+$/).filter((el) => !el.closest(".sr-only"));

  it("prices a spare roster copy", () => {
    renderSummary({ copies: { "ep-1": 2 }, sellValues: { "ep-1": 40 } });
    expect(worth()).toHaveLength(1);
    expect(worth()[0]).toHaveTextContent("Sell for 40");
  });

  it("prices a duplicate secret beside the wink", () => {
    withSecret({ secretDuplicate: true, secretCopies: 2, secretSellValue: 30 });
    expect(worth()[0]).toHaveTextContent("Sell for 30");
    // The line that was already there stays: the price is an addition to the
    // joke, not a replacement for it.
    expect(screen.getByText(/already yours/i)).toBeInTheDocument();
  });

  it("stays quiet when the route offers no price", () => {
    // Covers all three of the route's gates at once — a first copy, a guest, and
    // dust switched off all reach this component as nothing at all.
    renderSummary({ copies: { "ep-1": 1 }, sellValues: {} });
    withSecret({ secretDuplicate: true, secretCopies: 2, secretSellValue: null });
    expect(worth()).toHaveLength(0);
  });
});

describe("the way out", () => {
  it("offers both exits at full size", () => {
    renderSummary();
    // Both at neon-btn-lg. Share used to be a bordered ghost beside a small
    // primary, which read as "and you could also share it, I suppose".
    expect(screen.getByRole("link", { name: /view collection/i })).toHaveClass("neon-btn-lg");
    expect(screen.getByRole("button", { name: /share pack/i })).toHaveClass("neon-btn-lg");
  });

  it("keeps the collected counter it hid for the whole reveal", () => {
    renderSummary({ collected: 7, total: 13 });
    expect(screen.getByTestId("collected-count")).toHaveTextContent("7 / 13");
  });
});
