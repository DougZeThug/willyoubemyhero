// Answering an offer.
//
// The load-bearing part is the confirm sheet: Accept moves two people's cards
// and had nothing between the tap and the swap. The negative cases matter more
// than the positive one — cancelling must not call through, and a signal that
// drops while the question is on screen must take Confirm with it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TradeOffersPanel } from "./trade-offers";
import { rarityStyle } from "@/lib/card-rarity";
import type { TradeOfferView } from "@/lib/trades";
import { createQueryWrapper } from "@/test/query";

// A provider, because the tiles below now ask for the set list to print the set
// chip. Nothing in this file asserts on that query — it is the same shared key
// the vault already holds — but a component that reads TanStack Query cannot be
// rendered bare, and in the app these never are.
const { wrapper } = createQueryWrapper();

vi.mock("./holo-card", () => ({
  HoloCard: ({ name }: { name: string }) => <div>{name}</div>,
  FLIP_CURVE: "linear",
  FLIP_EDGE_AT: 0.384,
}));

const ME = "p-me";
const THEM = "p-them";
const NAMES: Record<string, string> = {
  [ME]: "Alice Ace",
  [THEM]: "Bob Blitz",
  "ep-alice": "Alice Ace",
  "ep-bob": "Bob Blitz",
};

const offer = (over: Partial<TradeOfferView> = {}): TradeOfferView => ({
  id: "offer-1",
  status: "pending",
  proposerId: THEM,
  recipientId: ME,
  createdAt: "2026-08-17T10:00:00Z",
  resolvedAt: null,
  // Bob's gold Bob for Alice's standard Alice — the audit's own example.
  proposerGives: [
    { kind: "roster", copyId: "c-theirs", eventParticipantId: "ep-bob", edition: "gold" },
  ],
  recipientGives: [
    { kind: "roster", copyId: "c-mine", eventParticipantId: "ep-alice", edition: "standard" },
  ],
  ...over,
});

/** A secret on the side you would be RECEIVING, filed into a set. */
const theirSecret = (viewerOwns: boolean): TradeOfferView["proposerGives"][number] => ({
  kind: "secret",
  pullId: "pull-1",
  name: "Gary The Grill",
  artUrl: null,
  tier: "mythic",
  collection: "pets",
  lastCopy: false,
  viewerOwns,
});

function renderPanel(over: Partial<React.ComponentProps<typeof TradeOffersPanel>> = {}) {
  const props: React.ComponentProps<typeof TradeOffersPanel> = {
    me: ME,
    inbox: [offer()],
    outbox: [],
    recent: [],
    nameOf: (id) => NAMES[id] ?? "Someone",
    lookup: (id) => ({ name: NAMES[id] ?? "—", frontUrl: null, rarity: rarityStyle("base") }),
    backUrl: null,
    pending: null,
    offline: false,
    onAccept: vi.fn(),
    onDecline: vi.fn(),
    onCancel: vi.fn(),
    highlightId: null,
    reachableCount: 3,
    ...over,
  };
  return { props, ...render(<TradeOffersPanel {...props} />, { wrapper }) };
}

beforeEach(() => {
  // The confirm sheet is a vaul Drawer, which claims the pointer on press.
  // jsdom has no pointer capture — the same stubs vault-sort-sheet.test.tsx
  // installs.
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  delete (HTMLElement.prototype as Partial<HTMLElement>).hasPointerCapture;
  delete (HTMLElement.prototype as Partial<HTMLElement>).setPointerCapture;
  delete (HTMLElement.prototype as Partial<HTMLElement>).releasePointerCapture;
  delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
  vi.clearAllMocks();
});

describe("accepting", () => {
  it("asks before it moves anything, and names both cards", async () => {
    const { props } = renderPanel();
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(props.onAccept).not.toHaveBeenCalled();
    expect(
      screen.getByText("Swap your Standard Alice Ace for Bob Blitz's Gold Bob Blitz?"),
    ).toBeInTheDocument();
  });

  it("goes through only on Confirm", async () => {
    const { props } = renderPanel();
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    await userEvent.click(screen.getByRole("button", { name: /^confirm$/i }));
    expect(props.onAccept).toHaveBeenCalledWith("offer-1");
  });

  it("moves nothing when the question is dismissed", async () => {
    const { props } = renderPanel();
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    await userEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(props.onAccept).not.toHaveBeenCalled();
  });

  it("takes Confirm with it when the signal drops mid-question", async () => {
    // The Accept behind this sheet is already offline-disabled. The signal can
    // go in the seconds between opening the question and answering it, and a
    // Confirm that stays lit through that is the one control here that would
    // throw a toast rather than going quiet.
    const { rerender, props } = renderPanel();
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    rerender(<TradeOffersPanel {...props} offline />);
    expect(screen.getByRole("button", { name: /^confirm$/i })).toBeDisabled();
  });
});

describe("the other two answers", () => {
  it("declines on one tap — nothing moves, and there is an undo behind it", async () => {
    const { props } = renderPanel();
    await userEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(props.onDecline).toHaveBeenCalledWith("offer-1");
    expect(screen.queryByRole("button", { name: /^confirm$/i })).not.toBeInTheDocument();
  });

  it("takes an offer back on one tap", async () => {
    const { props } = renderPanel({
      inbox: [],
      outbox: [offer({ proposerId: ME, recipientId: THEM })],
    });
    await userEvent.click(screen.getByRole("button", { name: /take it back/i }));
    expect(props.onCancel).toHaveBeenCalledWith("offer-1");
  });
});

describe("an empty inbox", () => {
  it("keeps the line and says who could answer it", () => {
    renderPanel({ inbox: [] });
    expect(screen.getByText("Nobody wants your cards. Yet.")).toBeInTheDocument();
    expect(screen.getByText("3 players are on their phones.")).toBeInTheDocument();
  });

  it("offers no control of its own, because the route's sticky one is the way forward", () => {
    // It used to carry "Start the first offer", named apart from the sticky
    // "Make an offer" so a screen reader could tell them apart — but they are one
    // action about 600px apart on a screen that is nothing but this panel (§23
    // F13). The survivor is the fixed one, which is up without a scroll.
    renderPanel({ inbox: [] });
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});

describe("more than one offer", () => {
  it("says which one is on screen, in words rather than dots", async () => {
    // The dots were decorative spans: no text, no label, nothing to anybody not
    // looking at them (§10 problem 8).
    renderPanel({ inbox: [offer(), offer({ id: "offer-2" })] });
    expect(screen.getByText("1 of 2")).toBeInTheDocument();
  });

  it("says nothing at all when there is only one", () => {
    renderPanel();
    expect(screen.queryByText("1 of 1")).not.toBeInTheDocument();
  });
});

describe("a settled offer", () => {
  it("is a receipt: its status in words, folded to a line until you open it", () => {
    renderPanel({ inbox: [], recent: [offer({ status: "accepted", resolvedAt: "2026-08-17T11:00:00Z" })] }); // prettier-ignore
    const receipt = screen.getByRole("article");
    expect(within(receipt).getByText("Done")).toBeInTheDocument();
    // The chip is readable folded. A status you have to open a receipt to read
    // is not a status.
    expect(within(receipt).queryByLabelText("You get")).not.toBeInTheDocument();
  });

  it("names both sides on the one line it is folded to", () => {
    // tradeItemsLabel COUNTS roster cards, so the strip used to fold down to
    // "1 card for 1 card" — which is the whole story, minus the story. Folded,
    // that line is all there is, so it names them through tradeItemName.
    renderPanel({ inbox: [], recent: [offer({ status: "accepted", resolvedAt: "2026-08-17T11:00:00Z" })] }); // prettier-ignore
    const receipt = screen.getByRole("article");
    expect(within(receipt).getByText("Standard Alice Ace for Gold Bob Blitz")).toBeInTheDocument();
    expect(within(receipt).queryByText("1 card for 1 card")).not.toBeInTheDocument();
  });

  it("still has nothing on it that answers an offer", () => {
    // What the old assertion was really claiming. A receipt is not a control
    // panel: it has exactly one button now, and that button only opens it.
    renderPanel({ inbox: [], recent: [offer({ status: "declined", resolvedAt: "2026-08-17T11:00:00Z" })] }); // prettier-ignore
    const receipt = screen.getByRole("article");
    const [only, ...rest] = within(receipt).getAllByRole("button");
    expect(rest).toHaveLength(0);
    // Anchored, because the one button there IS wears the status chip in its
    // accessible name — "Bob Blitz → You Declined" contains the word decline.
    expect(only).toHaveAttribute("aria-expanded");
    expect(within(receipt).queryByRole("button", { name: /^(accept|decline|take it back)$/i })).not.toBeInTheDocument(); // prettier-ignore
  });

  it("opens onto the cards, and says so on the control that opened it", async () => {
    renderPanel({ inbox: [], recent: [offer({ status: "accepted", resolvedAt: "2026-08-17T11:00:00Z" })] }); // prettier-ignore
    await userEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByRole("button", { expanded: true })).toBeInTheDocument();
    expect(screen.getByLabelText("You get")).toBeInTheDocument();
  });

  it("stays reachable as a heading, which a button's contents are not", () => {
    // The fold is a heading wrapping a control, not a control wrapping a
    // heading. A button's children are presentational in ARIA, so the other
    // shape would strike every receipt out of the heading rotor — the one way
    // anybody walks a strip of ten of these.
    renderPanel({ inbox: [], recent: [offer({ status: "accepted", resolvedAt: "2026-08-17T11:00:00Z" })] }); // prettier-ignore
    expect(screen.getByRole("heading", { name: /Bob Blitz → You/ })).toBeInTheDocument();
  });

  it("does not fold an offer that is still waiting on somebody", () => {
    // The cards ARE the live offer. Folding one would hide the thing the person
    // is being asked about.
    renderPanel();
    expect(screen.queryByRole("button", { expanded: false })).not.toBeInTheDocument();
    expect(screen.getByLabelText("You get")).toBeInTheDocument();
  });
});

/**
 * The set name is a fact about a card, and a card you do not hold is one this app
 * does not describe. The trade screen makes exactly one scoped exception to that —
 * it NAMES a secret inside an offer, because you cannot judge an offer sight
 * unseen — and the exception stops at the name.
 */
describe("a secret you do not hold", () => {
  it("keeps its set to itself on a face-down tile", () => {
    // The server does not withhold it here: getMyTradeOffers hydrates with
    // concealment off, so `collection` is on the wire. The tile is what withholds
    // it — which is why this is a test and not a comment. Saying "Pets" over a
    // card you have never seen is saying your Pets shelf is missing something.
    renderPanel({ inbox: [offer({ proposerGives: [theirSecret(false)] })] });
    expect(screen.queryByText("Pets")).not.toBeInTheDocument();
  });

  it("prints the set once the card is one you already have", () => {
    // Nothing is being withheld from somebody who owns a copy, and this is the
    // half that proves the test above is about concealment rather than about the
    // chip simply never rendering here.
    renderPanel({ inbox: [offer({ proposerGives: [theirSecret(true)] })] });
    expect(screen.getByText("Pets")).toBeInTheDocument();
  });
});
