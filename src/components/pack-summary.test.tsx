// Where the pack ends up, and what it says about what you just pulled.
//
// The summary is the curtain call: it is the only screen that lays all three
// cards out at once, and until the ribbons landed it was also the screen that
// said the least about them. What is pinned here is the sentence each card gets
// — new, better than yours, or another one, and what a spare is worth — that a
// secret sits in the slot it was dealt in, plus the two exits, because a payoff
// nobody can leave is not a payoff.
import { createElement, type ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PackSummary } from "./pack-summary";
import type { StandSlot } from "./pack-stand";
import { rarityStyle } from "@/lib/card-rarity";
import type { PackRosterSlot, PackSecretSlot } from "@/lib/pack";

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
    edition: slot?.edition === undefined ? "standard" : slot.edition,
    outcome: "new",
    copies: 1,
    sellValue: null,
    ep,
    ...rest,
  };
}

/** A secret slot, once the pack has been dealt. */
function secret(
  over: Omit<Partial<StandSlot>, "slot"> & { slot?: Partial<PackSecretSlot> } = {},
): StandSlot {
  const { slot, ...rest } = over;
  return {
    slot: {
      kind: "secret",
      id: "sec-1",
      card: { id: "sec-1", name: "Pickles", flavour: null, foil: "rosette", borderFx: "spin", collection: null, artUrl: null, backUrl: null, tier: "rare" }, // prettier-ignore
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

function renderSummary(over: Partial<React.ComponentProps<typeof PackSummary>> = {}) {
  return render(
    <PackSummary
      slots={THREE}
      bundle={null}
      cards={undefined}
      revealed={[0, 1, 2]}
      pullCounts={undefined}
      universalBack={null}
      collected={3}
      total={13}
      eventYear={2026}
      streak={null}
      claimable={null}
      canClaim={false}
      claiming={false}
      claimError={null}
      onClaim={() => {}}
      {...over}
    />,
  );
}

describe("the NEW / ×N / ↑ ribbon", () => {
  it("calls a roster card held zero times NEW", () => {
    renderSummary();
    expect(screen.getAllByRole("img", { name: "New card" })).toHaveLength(3);
  });

  it("counts a roster card already held twice as the third copy", () => {
    // held === 2 at deal time, so the copy on this screen is the third.
    renderSummary({
      slots: [roster(0, { outcome: "duplicate", copies: 3 }), roster(1), roster(2)],
    });
    expect(screen.getByRole("img", { name: "You now hold 3 of this card" })).toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: "New card" })).toHaveLength(2);
  });

  it("names the rung a better copy climbed to", () => {
    renderSummary({
      slots: [roster(0, { outcome: "upgrade", copies: 2, slot: { edition: "gold" } }), roster(1), roster(2)], // prettier-ignore
    });
    expect(screen.getByRole("img", { name: /^Upgraded to Gold/ })).toHaveTextContent("↑ Gold");
  });

  it("says nothing over a card the sequence has not turned yet", () => {
    // A column still waiting on its reveal is a card mid-ceremony, and its
    // ribbon would answer ahead of the flip.
    renderSummary({ revealed: [] });
    expect(screen.queryByRole("img", { name: /new card|you now hold/i })).toBeNull();
  });

  it("shows nothing for a card the route could not count", () => {
    // Silence beats a guess: assuming 1 would stamp NEW on a card this component
    // knows nothing about.
    renderSummary({ slots: THREE.map((s) => ({ ...s, copies: null })) });
    expect(screen.queryByRole("img", { name: /new card|you now hold/i })).toBeNull();
  });

  it("calls a secret that is not a duplicate NEW", () => {
    renderSummary({ slots: [roster(0), secret(), roster(2)] });
    expect(screen.getAllByRole("img", { name: "New card" })).toHaveLength(3);
  });

  it("counts a duplicate secret", () => {
    renderSummary({
      slots: [roster(0), secret({ outcome: "duplicate", copies: 2, slot: { duplicate: true } }), roster(2)], // prettier-ignore
    });
    expect(screen.getByRole("img", { name: "You now hold 2 of this card" })).toBeInTheDocument();
    expect(screen.getByText(/already yours/i)).toBeInTheDocument();
  });

  it("names the level an upgraded secret climbed to", () => {
    renderSummary({
      slots: [secret({ outcome: "upgrade", copies: 2, slot: { duplicate: true, tierBefore: "common" } })], // prettier-ignore
    });
    expect(screen.getByRole("img", { name: /^Upgraded to Rare/ })).toBeInTheDocument();
    // The level line stays: the level is the news, not the wink.
    expect(screen.queryByText(/already yours/i)).toBeNull();
  });
});

describe("a secret in its slot", () => {
  it("sits where it was dealt, not first", () => {
    renderSummary({ slots: [roster(0), roster(1), secret()] });
    const columns = screen.getAllByTestId("summary-card");
    expect(columns).toHaveLength(3);
    expect(columns[2]).toHaveTextContent("Pickles");
    expect(columns[0]).toHaveTextContent("Alice Ace");
  });

  it("says so in the subtitle once it has been turned", () => {
    renderSummary({ slots: [secret(), roster(1), roster(2)] });
    expect(screen.getByText(/secret and all/i)).toBeInTheDocument();
  });

  it("keeps the subtitle quiet while it is still face-down", () => {
    renderSummary({ slots: [secret(), roster(1), roster(2)], revealed: [1, 2] });
    expect(screen.getByText(/come back tomorrow/i)).toBeInTheDocument();
  });
});

describe("what a spare is worth", () => {
  const worth = () =>
    screen.queryAllByText(/^Sell for \d+$/).filter((el) => !el.closest(".sr-only"));

  it("prices a spare roster copy", () => {
    renderSummary({ slots: [roster(0, { outcome: "duplicate", copies: 2, sellValue: 40 }), roster(1), roster(2)] }); // prettier-ignore
    expect(worth()).toHaveLength(1);
    expect(worth()[0]).toHaveTextContent("Sell for 40");
  });

  it("prices a duplicate secret beside the wink", () => {
    renderSummary({
      slots: [secret({ outcome: "duplicate", copies: 2, sellValue: 30, slot: { duplicate: true } })], // prettier-ignore
    });
    expect(worth()[0]).toHaveTextContent("Sell for 30");
    // The line that was already there stays: the price is an addition to the
    // joke, not a replacement for it.
    expect(screen.getByText(/already yours/i)).toBeInTheDocument();
  });

  it("stays quiet when the route offers no price", () => {
    // Covers all three of the route's gates at once — a first copy, a guest, and
    // dust switched off all reach this component as nothing at all.
    renderSummary({ slots: [roster(0), secret({ outcome: "duplicate", copies: 2, slot: { duplicate: true } })] }); // prettier-ignore
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
