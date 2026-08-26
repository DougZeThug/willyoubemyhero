// The marketplace panel's cache bookkeeping.
//
// Not the panel's looks — the keys it invalidates, and the one key it is keyed
// ON. Every query a sale has to refresh is registered somewhere else, on a key
// spelled somewhere else, and getting that string wrong fails silently: the
// mutation succeeds, the toast fires, and the screen keeps showing the old world.
// dust-shop.test.tsx exists because that happened next door; this is the same
// pinning for the same reason.
//
// TWO THINGS HERE ARE NOT BOOKKEEPING. The shelf query is keyed on the VIEWER,
// because what a listing says about a secret depends on who is reading it — a
// shared key would serve one member another's de-concealed view out of the cache.
// And a buy mints one request id per tap and rotates it, because a lost response
// on a purchase is the worst bug this feature could ship.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createQueryWrapper } from "@/test/query";
import { dustBalanceKey } from "@/hooks/use-dust";
import { marketListingsKey, myStallKey } from "@/hooks/use-market";
import { mySecretsKey, secretStatusKey } from "@/hooks/use-daily-secret";
import { myCardStatsKey } from "@/hooks/use-my-collection";
import { cardPullCountsKey } from "@/hooks/use-card-pulls";
import { collectionTrophiesKey } from "@/hooks/use-collection-trophies";
import { tradeSparesKey } from "@/hooks/use-trades";
import { rarityStyle } from "@/lib/card-rarity";
import { MarketPanel } from "./market-panel";

const ME = "11111111-1111-4111-8111-111111111111";
const ACTOR = `m:${ME}`;
const EVENT = "22222222-2222-4222-8222-222222222222";
const THEM = "33333333-3333-4333-8333-333333333333";
const LISTING = "44444444-4444-4444-8444-444444444444";
const COPY = "55555555-5555-4555-8555-555555555555";

const browseFn = vi.hoisted(() => vi.fn());
const stallFn = vi.hoisted(() => vi.fn());
const buyFn = vi.hoisted(() => vi.fn());
const listFn = vi.hoisted(() => vi.fn());
const cancelFn = vi.hoisted(() => vi.fn());
const sparesFn = vi.hoisted(() => vi.fn());

vi.mock("@/lib/market.functions", () => ({
  getMarketListings: "fn:browse",
  getMyStall: "fn:stall",
  buyMarketListing: "fn:buy",
  listCardForDust: "fn:list",
  cancelMarketListing: "fn:cancel",
}));
vi.mock("@/lib/trades.functions", () => ({ getTradeSpares: "fn:spares" }));

vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: unknown) =>
    ({
      "fn:browse": browseFn,
      "fn:stall": stallFn,
      "fn:buy": buyFn,
      "fn:list": listFn,
      "fn:cancel": cancelFn,
      "fn:spares": sparesFn,
    })[fn as string] ?? browseFn,
}));

vi.mock("sonner", () => ({ toast: vi.fn() }));

// HoloCard drives a 3D tilt off imperative CSS custom properties and an image
// pipeline; none of that is what this file is about.
vi.mock("./holo-card", () => ({
  HoloCard: ({ name }: { name: string }) => <div>{name}</div>,
  FLIP_CURVE: "linear",
  FLIP_EDGE_AT: 0.384,
}));

type Invalidate = { mock: { calls: [{ queryKey: unknown }][] } };

/** Every key the component asked to refresh, stringified so they compare by value. */
const keys = (invalidate: Invalidate) =>
  invalidate.mock.calls.map((c) => JSON.stringify(c[0].queryKey));

function renderPanel(balance = 500, dustOn = true) {
  const { wrapper, client } = createQueryWrapper();
  const invalidate = vi.spyOn(client, "invalidateQueries") as unknown as Invalidate;
  const Wrapper = wrapper;
  const { container } = render(
    <Wrapper>
      <MarketPanel
        balance={balance}
        participantId={ME}
        actor={ACTOR}
        eventId={EVENT}
        nameFor={() => "Alice Ace"}
        nameOf={(id) => (id === THEM ? "Bob Bison" : "Someone")}
        lookup={() => ({ name: "Alice Ace", frontUrl: null, rarity: rarityStyle("base") })}
        backUrl={null}
        dustOn={dustOn}
      />
    </Wrapper>,
  );
  return { client, invalidate, container };
}

const rosterListing = {
  id: LISTING,
  sellerId: THEM,
  price: 120,
  createdAt: "2026-08-30T00:00:00Z",
  item: { kind: "roster" as const, eventParticipantId: "ep-1", edition: "gold" as const },
};

beforeEach(() => {
  vi.clearAllMocks();
  // The picker is a vaul Drawer, which claims the pointer on press. jsdom has no
  // pointer capture at all — the same three stubs card-prompt-studio.test.tsx
  // installs for its Radix select.
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  browseFn.mockResolvedValue({ listings: [rosterListing], nudgeTopic: null });
  stallFn.mockResolvedValue({ active: [], recent: [] });
  sparesFn.mockResolvedValue({
    participantId: ME,
    ownedRoster: [],
    roster: [],
    secrets: [],
    blocked: [],
  });
});

afterEach(() => {
  delete (HTMLElement.prototype as Partial<HTMLElement>).hasPointerCapture;
  delete (HTMLElement.prototype as Partial<HTMLElement>).setPointerCapture;
  delete (HTMLElement.prototype as Partial<HTMLElement>).releasePointerCapture;
  delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
});

describe("the shelf query", () => {
  it("is keyed on the viewer, because concealment is per-reader", async () => {
    // A shared key would serve one member another member's de-concealed view out
    // of the cache — the name and art of a secret they have never pulled.
    const { client } = renderPanel();
    await screen.findByRole("button", { name: /buy/i });
    const cached = client.getQueryCache().findAll({ queryKey: marketListingsKey(ME) });
    expect(cached).toHaveLength(1);
    expect(marketListingsKey(ME)).not.toEqual(marketListingsKey(THEM));
  });
});

describe("buying", () => {
  it("refreshes everything a sale moves, with the secrets keyed on the actor", async () => {
    // The trap dust-shop.tsx carries a live comment about: the secret queries
    // register as ["daily-secret", "m:<uuid>"], so a bare participant id here
    // matches nothing and fails silently.
    buyFn.mockResolvedValue({
      ok: true,
      price: 120,
      kind: "roster",
      eventParticipantId: "ep-1",
      edition: "gold",
      duplicate: false,
      completedCollection: null,
      balance: 380,
    });
    const { invalidate } = renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: /buy/i }));

    await waitFor(() => expect(buyFn).toHaveBeenCalled());
    const refreshed = keys(invalidate);
    for (const key of [
      marketListingsKey(ME),
      myStallKey(ME),
      ["dust-spares", ME],
      tradeSparesKey(ME),
      myCardStatsKey(EVENT, ME),
      // A buyer who held none of that card now holds one, so the public
      // "Packed by N" has genuinely risen.
      cardPullCountsKey(EVENT),
      mySecretsKey(ACTOR),
      secretStatusKey(ACTOR),
    ]) {
      expect(refreshed).toContain(JSON.stringify(key));
    }
  });

  it("writes the new balance in rather than refetching it", async () => {
    // The response already carries it, and a refetch would race the
    // invalidations above.
    buyFn.mockResolvedValue({
      ok: true,
      price: 120,
      kind: "roster",
      eventParticipantId: "ep-1",
      edition: "gold",
      duplicate: false,
      completedCollection: null,
      balance: 380,
    });
    const { client, invalidate } = renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: /buy/i }));

    await waitFor(() => expect(client.getQueryData(dustBalanceKey(ME))).toEqual({ balance: 380 }));
    expect(keys(invalidate)).not.toContain(JSON.stringify(dustBalanceKey(ME)));
  });

  it("refreshes the trophies only when a set actually closed", async () => {
    buyFn.mockResolvedValue({
      ok: true,
      price: 120,
      kind: "secret",
      eventParticipantId: null,
      edition: null,
      duplicate: false,
      completedCollection: null,
      balance: 380,
    });
    const { invalidate } = renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: /buy/i }));
    await waitFor(() => expect(buyFn).toHaveBeenCalled());
    expect(keys(invalidate)).not.toContain(JSON.stringify(collectionTrophiesKey()));
  });

  it("sends one request id per tap, so a lost response cannot charge twice", async () => {
    buyFn.mockResolvedValue({ ok: false, reason: "resolved" });
    renderPanel();
    const button = await screen.findByRole("button", { name: /buy/i });
    await userEvent.click(button);
    await waitFor(() => expect(buyFn).toHaveBeenCalledTimes(1));
    await userEvent.click(button);
    await waitFor(() => expect(buyFn).toHaveBeenCalledTimes(2));

    const [first, second] = buyFn.mock.calls.map((c) => c[0].data.requestId);
    // The same tap retried is the same purchase. Only a SUCCESS rotates the id.
    expect(first).toBe(second);
    expect(first).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/));
  });

  it("moves no balance and refreshes no collection when the buy was refused", async () => {
    buyFn.mockResolvedValue({ ok: false, reason: "insufficient" });
    const { client, invalidate } = renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: /buy/i }));
    await waitFor(() => expect(buyFn).toHaveBeenCalled());
    expect(client.getQueryData(dustBalanceKey(ME))).toBeUndefined();
    expect(keys(invalidate)).not.toContain(JSON.stringify(myCardStatsKey(EVENT, ME)));
  });

  it("says the price instead of offering a button you cannot press", async () => {
    // Being told the number you cannot meet is more use than a toast that says no,
    // and the RPC would refuse it anyway.
    renderPanel(10);
    const button = await screen.findByRole("button", { name: /120/ });
    expect(button).toBeDisabled();
  });
});

describe("listing and taking down", () => {
  it("refreshes the stall and the spares after a listing", async () => {
    sparesFn.mockResolvedValue({
      participantId: ME,
      ownedRoster: [],
      roster: [
        { copyId: COPY, eventParticipantId: "ep-1", edition: "gold", viewerOwns: true, assertedBy: "server" }, // prettier-ignore
      ],
      secrets: [],
      blocked: [],
    });
    listFn.mockResolvedValue({ ok: true, listingId: LISTING, price: 40 });
    const { invalidate } = renderPanel();

    await userEvent.click(await screen.findByRole("button", { name: /list a card/i }));
    await userEvent.click(await screen.findByRole("button", { name: /alice ace/i }));
    await userEvent.click(await screen.findByRole("button", { name: /list for/i }));

    await waitFor(() => expect(listFn).toHaveBeenCalled());
    const refreshed = keys(invalidate);
    expect(refreshed).toContain(JSON.stringify(myStallKey(ME)));
    expect(refreshed).toContain(JSON.stringify(["dust-spares", ME]));
  });

  it("starts the price at what the house would pay", async () => {
    // Nobody should shelve a platinum for three by accident, which is the one
    // mistake a free-text price field invites. A hint, never a rule — the field
    // stays editable in both directions.
    sparesFn.mockResolvedValue({
      participantId: ME,
      ownedRoster: [],
      roster: [
        { copyId: COPY, eventParticipantId: "ep-1", edition: "platinum", viewerOwns: true, assertedBy: "server" }, // prettier-ignore
      ],
      secrets: [],
      blocked: [],
    });
    renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: /list a card/i }));
    await userEvent.click(await screen.findByRole("button", { name: /alice ace/i }));
    expect(await screen.findByLabelText(/your price/i)).toHaveValue(100);
  });

  it("refreshes the stall after taking a listing down", async () => {
    stallFn.mockResolvedValue({
      active: [{ ...rosterListing, sellerId: ME, status: "active", buyerId: null, resolvedAt: null }], // prettier-ignore
      recent: [],
    });
    cancelFn.mockResolvedValue({ ok: true });
    const { invalidate } = renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: /take down/i }));
    await waitFor(() => expect(cancelFn).toHaveBeenCalledWith({ data: { listingId: LISTING } }));
    expect(keys(invalidate)).toContain(JSON.stringify(myStallKey(ME)));
  });
});

describe("the settled half of a stall", () => {
  it("is where a quiet sale is visible at all", async () => {
    // A sale writes no row into `trades` and reaches no public feed, so without
    // this list a seller learns about it as "huh, I have more dust".
    stallFn.mockResolvedValue({
      active: [],
      recent: [
        {
          ...rosterListing,
          sellerId: ME,
          status: "sold",
          buyerId: THEM,
          resolvedAt: "2026-08-30T01:00:00Z",
        },
      ],
    });
    renderPanel();
    // Exact, because the shelf above also names Bob — as the SELLER of the
    // listing this panel is browsing. The stall line is the one that says who
    // took your card.
    expect(await screen.findByText("to Bob Bison")).toBeInTheDocument();
    expect(await screen.findByText(/^sold$/i)).toBeInTheDocument();
  });
});

describe("while the commissioner has dust switched off", () => {
  const myListing = {
    ...rosterListing,
    sellerId: ME,
    status: "active" as const,
    buyerId: null,
    resolvedAt: null,
  };

  it("still offers the way to take a listing back down", async () => {
    // THE AFFORDANCE cancel_market_listing's design depends on. It is the one RPC
    // in the feature deliberately built without a dust_enabled() gate, so that
    // switching the economy off mid-party cannot strand somebody's cards on a
    // shelf they can no longer reach — and hiding this panel wholesale made that
    // promise a lie.
    stallFn.mockResolvedValue({ active: [myListing], recent: [] });
    cancelFn.mockResolvedValue({ ok: true });
    renderPanel(500, false);

    await userEvent.click(await screen.findByRole("button", { name: /take down/i }));
    await waitFor(() => expect(cancelFn).toHaveBeenCalledWith({ data: { listingId: LISTING } }));
  });

  it("shows no shelf and no way to list something new", async () => {
    // Both would answer `disabled` from Postgres, so offering either is a button
    // that exists only to say no.
    stallFn.mockResolvedValue({ active: [myListing], recent: [] });
    renderPanel(500, false);

    await screen.findByRole("button", { name: /take down/i });
    expect(screen.queryByRole("button", { name: /buy/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /list a card/i })).not.toBeInTheDocument();
  });

  it("asks for neither the shelf nor the spares", async () => {
    stallFn.mockResolvedValue({ active: [myListing], recent: [] });
    renderPanel(500, false);
    await screen.findByRole("button", { name: /take down/i });
    expect(browseFn).not.toHaveBeenCalled();
    expect(sparesFn).not.toHaveBeenCalled();
  });

  it("renders nothing at all when there is nothing to rescue", async () => {
    // Which is every case but the one above. The route's "not switched on yet"
    // line already says what the screen is; a second empty panel under it would
    // be noise.
    stallFn.mockResolvedValue({ active: [], recent: [] });
    const { container } = renderPanel(500, false);
    await waitFor(() => expect(stallFn).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
