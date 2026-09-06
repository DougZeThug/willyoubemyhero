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
    onMakeOffer: vi.fn(),
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
  it("keeps the line and gains a way forward", async () => {
    const { props } = renderPanel({ inbox: [] });
    expect(screen.getByText("Nobody wants your cards. Yet.")).toBeInTheDocument();
    expect(screen.getByText("3 players are on their phones.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /start the first offer/i }));
    expect(props.onMakeOffer).toHaveBeenCalledOnce();
  });

  it("names its control differently from the sticky one, so the two can be told apart", () => {
    renderPanel({ inbox: [] });
    // Two controls 200px apart with one accessible name is a thing a screen
    // reader cannot resolve, and the sticky "Make an offer" is always up.
    expect(screen.queryByRole("button", { name: /^make an offer$/i })).not.toBeInTheDocument();
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
  it("is a receipt, with its status in words and nothing to press", () => {
    renderPanel({ inbox: [], recent: [offer({ status: "accepted", resolvedAt: "2026-08-17T11:00:00Z" })] }); // prettier-ignore
    const receipt = screen.getByRole("article");
    expect(within(receipt).getByText("Done")).toBeInTheDocument();
    expect(within(receipt).queryByRole("button")).not.toBeInTheDocument();
  });
});
