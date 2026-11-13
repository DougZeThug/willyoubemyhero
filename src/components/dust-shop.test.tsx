// The dust shop's cache bookkeeping.
//
// Not the panel's looks — the keys it invalidates. Every query this component
// has to refresh after a purchase is registered somewhere else, on a key spelled
// somewhere else, and getting that string wrong fails silently: the mutation
// succeeds, the toast fires, and the screen keeps showing the old world. That is
// exactly what happened here, so the keys are pinned rather than the prose.
//
// One thing here is NOT bookkeeping: the confirm before a last-copy sale. There
// is no last-copy rule in SQL — any secret sells, which is the feature — so that
// dialog is the only thing between a thumb and a vanished mythic.
import {
  collectionTrophiesKey,
  dustBalanceKey,
  mySecretsKey,
  packStatusKey,
  tradeSparesKey,
} from "@/lib/query-keys";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createQueryWrapper } from "@/test/query";
import { DUST_PRICES, SELL_BY_SECRET_TIER } from "@/lib/dust";
import { toast } from "sonner";
import { DustShopPanel } from "./dust-shop";

const ME = "11111111-1111-4111-8111-111111111111";
const ACTOR = `m:${ME}`;
const EVENT = "22222222-2222-4222-8222-222222222222";

const buyFn = vi.hoisted(() => vi.fn());
const millFn = vi.hoisted(() => vi.fn());
const rerollFn = vi.hoisted(() => vi.fn());
const sparesFn = vi.hoisted(() => vi.fn());
const sellFn = vi.hoisted(() => vi.fn());

// The server functions are replaced by sentinels so useServerFn can tell which
// one it was handed. The component binds all of them at render, and a real
// createServerFn would try to reach the network.
vi.mock("@/lib/dust.functions", () => ({
  buyBonusSecretPull: "fn:buy",
  millCardCopy: "fn:mill",
  rerollCopyEdition: "fn:reroll",
  sellSecretCard: "fn:sell",
}));

vi.mock("@/lib/trades.functions", () => ({ getTradeSpares: "fn:spares" }));

vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: unknown) =>
    ({
      "fn:buy": buyFn,
      "fn:mill": millFn,
      "fn:reroll": rerollFn,
      "fn:sell": sellFn,
      "fn:spares": sparesFn,
    })[fn as string] ?? buyFn,
}));

vi.mock("sonner", () => ({ toast: vi.fn() }));

// null, not undefined, for "still loading": undefined would pick up the default.
function renderShop(given: number | null = DUST_PRICES.bonusPull) {
  const balance = given ?? undefined;
  const { wrapper, client } = createQueryWrapper();
  const invalidate = vi.spyOn(client, "invalidateQueries") as unknown as Invalidate;
  const Wrapper = wrapper;
  render(
    <Wrapper>
      <DustShopPanel
        balance={balance}
        participantId={ME}
        eventId={EVENT}
        nameFor={() => "Alice Ace"}
      />
    </Wrapper>,
  );
  return { client, invalidate };
}

type Invalidate = { mock: { calls: [{ queryKey: unknown }][] } };

/** Every key the component asked to refresh, stringified so they compare by value. */
const keys = (invalidate: Invalidate) =>
  invalidate.mock.calls.map((c) => JSON.stringify(c[0].queryKey));

beforeEach(() => {
  vi.clearAllMocks();
  sparesFn.mockResolvedValue({
    participantId: ME,
    ownedRoster: [],
    roster: [],
    secrets: [],
    blocked: [],
  });
});

describe("buying a pull", () => {
  it("refreshes the secret queries on the actor, which is how they are keyed", async () => {
    // The bug this file exists for: these are registered as
    // ["daily-secret", "m:<uuid>"], so invalidating on the bare uuid matched
    // nothing and the bought card stayed missing behind a "check your secrets".
    buyFn.mockResolvedValue({
      ok: true,
      price: DUST_PRICES.bonusPull,
      balance: 0,
      pull: { completedCollection: null },
    });
    const { invalidate } = renderShop();

    await userEvent.click(screen.getByRole("button", { name: /buy for/i }));

    await waitFor(() => expect(buyFn).toHaveBeenCalled());
    const seen = keys(invalidate);
    expect(seen).toContain(JSON.stringify(packStatusKey(ACTOR)));
    expect(seen).toContain(JSON.stringify(mySecretsKey(ACTOR)));
    // And never the bare id, which is the shape that silently matched nothing.
    expect(seen).not.toContain(JSON.stringify(packStatusKey(ME)));
  });

  it("refreshes both spares lists, which a granted pull joins on the spot", async () => {
    // buy_bonus_secret_pull mints the row `granted`, and getTradeSpares stakes a
    // granted row the day it arrives — so the card is sellable and offerable
    // immediately, and both lists are cached. Buying was the one mutation here
    // that moved them without saying so, and neither list has a realtime channel
    // to notice on its own.
    buyFn.mockResolvedValue({
      ok: true,
      price: DUST_PRICES.bonusPull,
      balance: 0,
      pull: { completedCollection: null, duplicate: true, cardId: "sc-new" },
    });
    const { invalidate } = renderShop();

    await userEvent.click(screen.getByRole("button", { name: /buy for/i }));

    await waitFor(() => expect(buyFn).toHaveBeenCalled());
    const seen = keys(invalidate);
    // The shop's own "Sell a secret" list, and the Trading Post's, which read the
    // same spares under two different keys.
    expect(seen).toContain(JSON.stringify(["dust-spares", ME]));
    expect(seen).toContain(JSON.stringify(tradeSparesKey(ME)));
  });

  it("writes the new balance straight in rather than refetching it", async () => {
    // dust_ledger is not published to realtime, and the response already carries
    // the number — a round trip here would show a stale one behind the ceremony.
    buyFn.mockResolvedValue({
      ok: true,
      price: DUST_PRICES.bonusPull,
      balance: 25,
      pull: { completedCollection: null },
    });
    const { client } = renderShop();

    await userEvent.click(screen.getByRole("button", { name: /buy for/i }));

    await waitFor(() => expect(client.getQueryData(dustBalanceKey(ME))).toEqual({ balance: 25 }));
  });

  it("refreshes the trophy shelf only when the pull actually finished a set", async () => {
    buyFn.mockResolvedValue({
      ok: true,
      price: DUST_PRICES.bonusPull,
      balance: 0,
      pull: { completedCollection: { collection: "set-a", size: 2 } },
    });
    const { invalidate } = renderShop();

    await userEvent.click(screen.getByRole("button", { name: /buy for/i }));

    await waitFor(() => expect(buyFn).toHaveBeenCalled());
    expect(keys(invalidate)).toContain(JSON.stringify(collectionTrophiesKey()));
  });

  it("leaves the trophy shelf alone on an ordinary pull", async () => {
    buyFn.mockResolvedValue({
      ok: true,
      price: DUST_PRICES.bonusPull,
      balance: 0,
      pull: { completedCollection: null },
    });
    const { invalidate } = renderShop();

    await userEvent.click(screen.getByRole("button", { name: /buy for/i }));

    await waitFor(() => expect(buyFn).toHaveBeenCalled());
    expect(keys(invalidate)).not.toContain(JSON.stringify(collectionTrophiesKey()));
  });

  it("refreshes nothing when the purchase was refused", async () => {
    buyFn.mockResolvedValue({ ok: false, reason: "insufficient", balance: 20 });
    const { invalidate, client } = renderShop();

    await userEvent.click(screen.getByRole("button", { name: /buy for/i }));

    await waitFor(() => expect(buyFn).toHaveBeenCalled());
    expect(keys(invalidate)).not.toContain(JSON.stringify(packStatusKey(ACTOR)));
    expect(client.getQueryData(dustBalanceKey(ME))).toBeUndefined();
  });
});

describe("re-rolling a finish", () => {
  const ONLY_COPY = "55555555-5555-4555-8555-555555555555";

  function withOneCard() {
    // Held once, so it is absent from `roster` — and present in `ownedRoster`,
    // which is the whole reason that field exists.
    sparesFn.mockResolvedValue({
      participantId: ME,
      ownedRoster: [
        {
          copyId: ONLY_COPY,
          eventParticipantId: "ep-1",
          edition: "gold",
          assertedBy: "client",
        },
      ],
      roster: [],
      secrets: [],
      blocked: [],
    });
  }

  it("offers a card you hold only one of, which cannot be burned", async () => {
    withOneCard();
    renderShop();
    // The burn list is spares only and stays empty; the re-roll list is not.
    expect(await screen.findByRole("button", { name: /re-roll/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /burn/i })).toBeNull();
  });

  it("sends a fresh request id per tap, so one gamble is never replayed", async () => {
    withOneCard();
    rerollFn.mockResolvedValue({
      ok: true,
      price: DUST_PRICES.reroll,
      from: "gold",
      to: "standard",
      eventParticipantId: "ep-1",
      balance: 0,
    });
    renderShop();

    await userEvent.click(await screen.findByRole("button", { name: /re-roll/i }));
    await waitFor(() => expect(rerollFn).toHaveBeenCalledTimes(1));
    await userEvent.click(await screen.findByRole("button", { name: /re-roll/i }));
    await waitFor(() => expect(rerollFn).toHaveBeenCalledTimes(2));

    const ids = rerollFn.mock.calls.map(
      (c) => (c[0] as { data: { requestId: string } }).data.requestId,
    );
    expect(ids[0]).not.toBe(ids[1]);
    // And both name the copy, which is the half the RPC actually acts on.
    for (const c of rerollFn.mock.calls) {
      expect((c[0] as { data: { cardCopyId: string } }).data.cardCopyId).toBe(ONLY_COPY);
    }
  });

  it("refreshes the copy lists once a roll lands", async () => {
    withOneCard();
    rerollFn.mockResolvedValue({
      ok: true,
      price: DUST_PRICES.reroll,
      from: "gold",
      to: "platinum",
      eventParticipantId: "ep-1",
      balance: 10,
    });
    const { invalidate, client } = renderShop();

    await userEvent.click(await screen.findByRole("button", { name: /re-roll/i }));

    await waitFor(() => expect(rerollFn).toHaveBeenCalled());
    expect(keys(invalidate)).toContain(JSON.stringify(["dust-spares", ME]));
    expect(client.getQueryData(dustBalanceKey(ME))).toEqual({ balance: 10 });
  });
});

describe("selling a secret", () => {
  const PULL = "66666666-6666-4666-8666-666666666666";

  /** One secret held, at the level the assertion quotes. */
  function withSecret(over: Record<string, unknown> = {}) {
    sparesFn.mockResolvedValue({
      participantId: ME,
      ownedRoster: [],
      roster: [],
      secrets: [
        {
          pullId: PULL,
          name: "Gary The Grill",
          artUrl: null,
          tier: "legendary",
          lastCopy: false,
          viewerOwns: true,
          ...over,
        },
      ],
      blocked: [],
    });
  }

  const sold = {
    ok: true,
    awarded: SELL_BY_SECRET_TIER.legendary,
    tier: "legendary",
    secretCardId: "sc-gary",
    balance: 320,
  };

  it("quotes the copy's own level rather than a flat rate", async () => {
    // The whole point of this release: a mythic duplicate and a common one used
    // to pay the same 25.
    withSecret();
    renderShop();
    expect(
      await screen.findByRole("button", {
        name: new RegExp(`sell \\+${SELL_BY_SECRET_TIER.legendary}`, "i"),
      }),
    ).toBeTruthy();
  });

  it("refreshes the vault's secret shelf and its count, both on the actor", async () => {
    // The keys this file exists for. mySecrets and daily-secret are registered as
    // ["my-secrets", "m:<uuid>"] and ["daily-secret", "m:<uuid>"], so a bare
    // participant id matches neither and the sold card would sit in the vault
    // until the staleTime ran out.
    withSecret();
    sellFn.mockResolvedValue(sold);
    const { invalidate, client } = renderShop();

    await userEvent.click(await screen.findByRole("button", { name: /sell \+/i }));

    await waitFor(() => expect(sellFn).toHaveBeenCalled());
    const seen = keys(invalidate);
    expect(seen).toContain(JSON.stringify(["dust-spares", ME]));
    expect(seen).toContain(JSON.stringify(mySecretsKey(ACTOR)));
    expect(seen).toContain(JSON.stringify(packStatusKey(ACTOR)));
    expect(seen).not.toContain(JSON.stringify(mySecretsKey(ME)));
    // Written straight in, never refetched — same rule as every other mutation.
    expect(client.getQueryData(dustBalanceKey(ME))).toEqual({ balance: 320 });
  });

  it("names the pull row, which is the half the RPC acts on", async () => {
    withSecret();
    sellFn.mockResolvedValue(sold);
    renderShop();

    await userEvent.click(await screen.findByRole("button", { name: /sell \+/i }));

    await waitFor(() => expect(sellFn).toHaveBeenCalled());
    expect((sellFn.mock.calls[0][0] as { data: { secretPullId: string } }).data.secretPullId).toBe(
      PULL,
    );
  });

  it("warns before a last copy leaves the collection, and stops if you say no", async () => {
    // There is no last-copy rule in SQL — any secret sells, which is the feature
    // — so this confirm is the only thing between a thumb and a vanished mythic.
    withSecret({ lastCopy: true });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderShop();

    await userEvent.click(await screen.findByRole("button", { name: /sell \+/i }));

    expect(confirmSpy).toHaveBeenCalled();
    expect(sellFn).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("sells the last copy once it has been confirmed", async () => {
    withSecret({ lastCopy: true });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    sellFn.mockResolvedValue(sold);
    renderShop();

    await userEvent.click(await screen.findByRole("button", { name: /sell \+/i }));

    await waitFor(() => expect(sellFn).toHaveBeenCalledTimes(1));
    confirmSpy.mockRestore();
  });

  it("asks nothing before selling a copy you hold more than one of", async () => {
    withSecret({ lastCopy: false });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    sellFn.mockResolvedValue(sold);
    renderShop();

    await userEvent.click(await screen.findByRole("button", { name: /sell \+/i }));

    await waitFor(() => expect(sellFn).toHaveBeenCalled());
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("refreshes nothing when the sale was refused", async () => {
    withSecret();
    sellFn.mockResolvedValue({ ok: false, reason: "staked" });
    const { invalidate, client } = renderShop();

    await userEvent.click(await screen.findByRole("button", { name: /sell \+/i }));

    await waitFor(() => expect(sellFn).toHaveBeenCalled());
    expect(keys(invalidate)).not.toContain(JSON.stringify(mySecretsKey(ACTOR)));
    expect(client.getQueryData(dustBalanceKey(ME))).toBeUndefined();
  });
});

describe("an older server's same-day refusal", () => {
  // Production ran a server that still answered `too_fresh` for today's pull
  // while the app already listed it, and the Shop said "Could not burn that one"
  // — which reads as a bug. Nothing from 20260930120000 on returns it.
  const COPY = "77777777-7777-4777-8777-777777777777";
  const PULL = "88888888-8888-4888-8888-888888888888";

  beforeEach(() => {
    sparesFn.mockResolvedValue({
      participantId: ME,
      ownedRoster: [],
      roster: [{ copyId: COPY, eventParticipantId: "ep-1", edition: "gold", assertedBy: "server" }],
      secrets: [
        {
          pullId: PULL,
          name: "Gary The Grill",
          artUrl: null,
          tier: "rare",
          lastCopy: false,
          viewerOwns: true,
        },
      ],
      blocked: [],
    });
  });

  it("says so in words when the burn is refused", async () => {
    millFn.mockResolvedValue({ ok: false, reason: "too_fresh" });
    renderShop();

    await userEvent.click(await screen.findByRole("button", { name: /burn \+/i }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith("Today's pull can be dusted from tomorrow")); // prettier-ignore
  });

  it("says so in words when the sale is refused", async () => {
    sellFn.mockResolvedValue({ ok: false, reason: "too_fresh" });
    renderShop();

    await userEvent.click(await screen.findByRole("button", { name: /sell \+/i }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith("Today's pull can be dusted from tomorrow")); // prettier-ignore
  });
});

describe("a failed spares read", () => {
  it("says so in all three lists instead of reading as empty, and Try again asks once more", async () => {
    // spares runs retry:false, so one rejection is the whole outage. Before this
    // the three lists fell through to "No spares yet." and friends.
    sparesFn.mockRejectedValue(new Error("boom"));
    renderShop();

    expect(await screen.findByText("Couldn't read your spares just now.")).toBeTruthy();
    expect(screen.getByText("Couldn't read your secrets just now.")).toBeTruthy();
    expect(screen.getByText("Couldn't read your cards just now.")).toBeTruthy();
    expect(screen.queryByText("No spares yet.")).toBeNull();
    expect(screen.queryByText("No secrets yet.")).toBeNull();

    sparesFn.mockClear();
    await userEvent.click(screen.getAllByRole("button", { name: "Try again" })[0]);
    await waitFor(() => expect(sparesFn).toHaveBeenCalledTimes(1));
  });

  it("keeps the plain empty lines for a read that succeeded with nothing", async () => {
    renderShop();
    expect(await screen.findByText("No spares yet.")).toBeTruthy();
    expect(screen.queryByText(/Couldn't read/)).toBeNull();
  });
});

describe("sell a secret: duplicates grouped by name", () => {
  const copy = (
    pullId: string,
    name: string,
    tier: string,
    over: Record<string, unknown> = {},
  ) => ({
    pullId,
    name,
    artUrl: null,
    tier,
    collection: null,
    lastCopy: false,
    viewerOwns: true,
    ...over, // prettier-ignore
  });
  const hold = (secrets: unknown[]) =>
    sparesFn.mockResolvedValue({ participantId: ME, ownedRoster: [], roster: [], secrets, blocked: [] }); // prettier-ignore
  const sellSection = async () => {
    const heading = await screen.findByRole("heading", { name: /sell a secret/i });
    return heading.closest("section") as HTMLElement;
  };

  it("orders groups by their best copy and copies inside a group by value", async () => {
    // Interleaved on purpose: a flat sort by value would put Loose Leaf's rare
    // between two Gary copies.
    hold([
      copy("p1", "Gary The Grill", "common"),
      copy("p2", "Loose Leaf", "rare"),
      copy("p3", "Gary The Grill", "legendary"),
      copy("p4", "Sir Barks A Lot", "epic"),
      copy("p5", "Gary The Grill", "rare"),
      copy("p6", "Sir Barks A Lot", "common"),
    ]);
    renderShop();
    const section = await sellSection();
    await within(section).findAllByRole("button", { name: /sell \+/i });
    const text = (el: Element) => el.textContent ?? "";
    const names = within(section)
      .getAllByText(/^(Gary The Grill|Loose Leaf|Sir Barks A Lot)$/)
      .map(text);
    expect(names).toEqual(["Gary The Grill", "Sir Barks A Lot", "Loose Leaf"]);
    const prices = within(section)
      .getAllByRole("button", { name: /sell \+/i })
      .map((b) => Number(/\d+/.exec(text(b))?.[0]));
    const v = SELL_BY_SECRET_TIER;
    expect(prices).toEqual([v.legendary, v.rare, v.common, v.epic, v.common, v.rare]);
  });

  it("keeps a single copy as a plain row with no count", async () => {
    hold([copy("p1", "Loose Leaf", "rare")]);
    renderShop();
    const section = await sellSection();
    await within(section).findByRole("button", { name: /sell \+/i });
    expect(within(section).queryByText(/×/)).toBeNull();
    expect(within(section).getByText("Loose Leaf").closest("li")?.className).toMatch(/flex-wrap/);
  });

  it("shows a duplicate's name once with ×N and a Sell at each copy's own price", async () => {
    hold([copy("p1", "Gary The Grill", "legendary"), copy("p2", "Gary The Grill", "common")]);
    renderShop();
    const section = await sellSection();
    const buttons = await within(section).findAllByRole("button", { name: /sell \+/i });
    expect(within(section).getAllByText("Gary The Grill")).toHaveLength(1);
    expect(within(section).getByText("×2")).toBeTruthy();
    expect(buttons.map((b) => b.textContent)).toEqual([
      `Sell +${SELL_BY_SECRET_TIER.legendary}`,
      `Sell +${SELL_BY_SECRET_TIER.common}`,
    ]);
    sellFn.mockResolvedValue({
      ok: true,
      awarded: 1,
      tier: "common",
      secretCardId: "x",
      balance: 1,
    });
    await userEvent.click(buttons[1]);
    await waitFor(() => expect(sellFn).toHaveBeenCalledWith({ data: { secretPullId: "p2" } }));
  });

  it("still confirms before selling a last copy inside a group", async () => {
    hold([copy("p1", "Gary The Grill", "legendary", { lastCopy: true }), copy("p2", "Gary The Grill", "common")]); // prettier-ignore
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    try {
      renderShop();
      const section = await sellSection();
      const [first] = await within(section).findAllByRole("button", { name: /sell \+/i });
      await userEvent.click(first);
      expect(confirmSpy).toHaveBeenCalled();
      expect(sellFn).not.toHaveBeenCalled();
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it("counts copies, not names, in the badge", async () => {
    hold([
      copy("p1", "Gary The Grill", "legendary"),
      copy("p2", "Gary The Grill", "common"),
      copy("p3", "Loose Leaf", "rare"),
    ]);
    renderShop();
    const section = await sellSection();
    await within(section).findAllByRole("button", { name: /sell \+/i });
    expect(screen.getByRole("heading", { name: /sell a secret/i }).parentElement?.textContent).toMatch(/3/); // prettier-ignore
  });

  it("describes each grouped Sell by the card's name and its own level, singles not at all", async () => {
    hold([
      copy("p1", "Gary The Grill", "legendary"),
      copy("p2", "Gary The Grill", "common"),
      copy("p3", "Loose Leaf", "rare"),
    ]);
    renderShop();
    const section = await sellSection();
    const [legendary, common, single] = await within(section).findAllByRole("button", { name: /sell \+/i }); // prettier-ignore
    const describe = (b: HTMLElement) =>
      (b.getAttribute("aria-describedby") ?? "")
        .split(" ")
        .filter(Boolean)
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ");
    expect(describe(legendary)).toBe("Gary The Grill Legendary");
    expect(describe(common)).toBe("Gary The Grill Common");
    expect(single.hasAttribute("aria-describedby")).toBe(false);
    // The visible label stays the accessible name the tests and e2e look up.
    expect(legendary.textContent).toBe(`Sell +${SELL_BY_SECRET_TIER.legendary}`);
  });

  it("groups by card id, so two different cards that share a name stay apart", async () => {
    hold([
      copy("p1", "Gary The Grill", "legendary", { cardId: "card-a" }),
      copy("p2", "Gary The Grill", "common", { cardId: "card-b" }),
    ]);
    renderShop();
    const section = await sellSection();
    await within(section).findAllByRole("button", { name: /sell \+/i });
    expect(within(section).getAllByText("Gary The Grill")).toHaveLength(2);
    expect(within(section).queryByText(/×/)).toBeNull();
  });

  it("groups copies of one card id even when the name text differs", async () => {
    hold([
      copy("p1", "Gary The Grill", "legendary", { cardId: "card-a" }),
      copy("p2", "Gary the Grill", "common", { cardId: "card-a" }),
    ]);
    renderShop();
    const section = await sellSection();
    await within(section).findAllByRole("button", { name: /sell \+/i });
    expect(within(section).getByText("×2")).toBeTruthy();
  });

  it("shows a shared set once under the name, differing sets per copy", async () => {
    hold([
      copy("p1", "Gary The Grill", "legendary", { collection: "cornhole" }),
      copy("p2", "Gary The Grill", "common", { collection: "cornhole" }),
      copy("p3", "Sir Barks A Lot", "epic", { collection: "cornhole" }),
      copy("p4", "Sir Barks A Lot", "common", { collection: "pets" }),
    ]);
    renderShop();
    const section = await sellSection();
    await within(section).findAllByRole("button", { name: /sell \+/i });
    expect(within(section).getAllByText("Cornhole Collection")).toHaveLength(2);
  });
});

describe("narrow-phone layout", () => {
  it("shows the set chip outside the Sell button and apart from the last-copy tag", async () => {
    // The chip lives under the whole row so it is not squeezed beside Sell on a
    // narrow phone; jsdom has no layout, so what is checkable is who contains it.
    sparesFn.mockResolvedValue({
      participantId: ME,
      ownedRoster: [],
      roster: [],
      secrets: [
        { pullId: "p1", name: "Gary The Grill", artUrl: null, tier: "legendary", collection: "cornhole", lastCopy: true, viewerOwns: true }, // prettier-ignore
      ],
      blocked: [],
    });
    renderShop();
    const last = await screen.findByText("last copy");
    const chip = screen.getByText("Cornhole Collection");
    const sell = screen.getByRole("button", { name: /sell \+/i });
    expect(chip).toBeVisible();
    expect(sell.contains(chip)).toBe(false);
    expect(last.parentElement?.contains(chip)).toBe(false);
  });

  it("leaves no empty chip line under a secret that is not filed in a set", async () => {
    sparesFn.mockResolvedValue({
      participantId: ME,
      ownedRoster: [],
      roster: [],
      secrets: [
        { pullId: "p2", name: "Loose Leaf", artUrl: null, tier: "rare", collection: null, lastCopy: false, viewerOwns: true }, // prettier-ignore
      ],
      blocked: [],
    });
    renderShop();
    await screen.findByRole("button", { name: /sell \+/i });
    expect(screen.queryByText(/collection/i)).toBeNull();
  });
});

describe("the settle list cap", () => {
  function withCards(n: number) {
    sparesFn.mockResolvedValue({
      participantId: ME,
      ownedRoster: Array.from({ length: n }, (_, i) => ({
        copyId: `copy-${i}`,
        eventParticipantId: "ep-1",
        edition: "gold",
        assertedBy: "server",
      })),
      roster: [],
      secrets: [],
      blocked: [],
    });
  }

  it("shows no button at 3 cards or fewer", async () => {
    withCards(3);
    renderShop();
    expect(await screen.findAllByRole("button", { name: /re-roll/i })).toHaveLength(3);
    expect(screen.queryByRole("button", { name: /show (all|less)/i })).toBeNull();
  });

  it("shows 3 rows and Show all N past 3, with the total in the badge", async () => {
    withCards(5);
    renderShop();
    expect(await screen.findAllByRole("button", { name: /re-roll/i })).toHaveLength(3);
    const btn = screen.getByRole("button", { name: "Show all 5" });
    expect(btn).toHaveAttribute("aria-expanded", "false");
    const heading = screen.getByRole("heading", { name: /settle a finish/i });
    expect(heading.parentElement?.textContent).toMatch(/5/);
  });

  it("reveals every row, flips to Show less, and folds back", async () => {
    withCards(5);
    renderShop();
    await userEvent.click(await screen.findByRole("button", { name: "Show all 5" }));
    expect(screen.getAllByRole("button", { name: /re-roll/i })).toHaveLength(5);
    const less = screen.getByRole("button", { name: "Show less" });
    expect(less).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(less.getAttribute("aria-controls") ?? "")).toBeTruthy();
    await userEvent.click(less);
    expect(screen.getAllByRole("button", { name: /re-roll/i })).toHaveLength(3);
  });

  it("drops the button when a refetch leaves 3 or fewer", async () => {
    withCards(4);
    const { client } = renderShop();
    await userEvent.click(await screen.findByRole("button", { name: "Show all 4" }));
    withCards(3);
    await client.invalidateQueries({ queryKey: ["dust-spares", ME] });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /show (all|less)/i })).toBeNull(),
    );
    expect(screen.getAllByRole("button", { name: /re-roll/i })).toHaveLength(3);
  });
});

describe("saying why the re-roll buttons are dead", () => {
  const ROLL = "99999999-9999-4999-8999-999999999999";

  function withCards(rows: number) {
    sparesFn.mockResolvedValue({
      participantId: ME,
      ownedRoster: Array.from({ length: rows }, (_, i) => ({
        copyId: i === 0 ? ROLL : `copy-${i}`,
        eventParticipantId: "ep-1",
        edition: "gold",
        assertedBy: "server",
      })),
      roster: [],
      secrets: [],
      blocked: [],
    });
  }

  it("counts the shortfall when the balance is under the price and there are rows", async () => {
    withCards(1);
    renderShop(DUST_PRICES.reroll - 7);
    expect(await screen.findByText("7 more to re-roll")).toBeTruthy();
    expect(screen.getByRole("button", { name: /re-roll/i })).toBeDisabled();
  });

  it("is absent once the price is covered", async () => {
    withCards(1);
    renderShop(DUST_PRICES.reroll);
    await screen.findByRole("button", { name: /re-roll/i });
    expect(screen.queryByText(/more to re-roll/)).toBeNull();
  });

  it("is absent when there is nothing to re-roll", async () => {
    withCards(0);
    renderShop(0);
    await screen.findByText("No cards yet.");
    expect(screen.queryByText(/more to re-roll/)).toBeNull();
  });

  it("is absent while the balance is still unknown", async () => {
    withCards(1);
    renderShop(null);
    await screen.findByRole("button", { name: /re-roll/i });
    expect(screen.queryByText(/more to re-roll/)).toBeNull();
  });
});

describe("toasts name the card", () => {
  const COPY = "77777777-7777-4777-8777-777777777777";
  const PULL = "88888888-8888-4888-8888-888888888888";

  beforeEach(() => {
    sparesFn.mockResolvedValue({
      participantId: ME,
      ownedRoster: [
        { copyId: COPY, eventParticipantId: "ep-1", edition: "gold", assertedBy: "server" },
      ],
      roster: [{ copyId: COPY, eventParticipantId: "ep-1", edition: "gold", assertedBy: "server" }],
      secrets: [
        {
          pullId: PULL,
          name: "Gary The Grill",
          artUrl: null,
          tier: "rare",
          lastCopy: false,
          viewerOwns: true,
        },
      ],
      blocked: [],
    });
  });

  it("burn: who and how much", async () => {
    millFn.mockResolvedValue({ ok: true, awarded: 40, balance: 90 });
    renderShop();
    await userEvent.click(await screen.findByRole("button", { name: /burn \+/i }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Burned Alice Ace · +40 dust"));
    // The name is for the toast only. What reaches the server is the copy id and
    // nothing else: it is the client's word for who, and the server never needs it.
    expect(millFn).toHaveBeenCalledWith({ data: { cardCopyId: COPY } });
  });

  it("sell: the secret's name and how much", async () => {
    sellFn.mockResolvedValue({ ok: true, awarded: 120, balance: 200 });
    renderShop();
    await userEvent.click(await screen.findByRole("button", { name: /sell \+/i }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Sold Gary The Grill · +120 dust"));
    expect(sellFn).toHaveBeenCalledWith({ data: { secretPullId: PULL } });
  });

  it("re-roll: who, and both finishes", async () => {
    rerollFn.mockResolvedValue({ ok: true, from: "gold", to: "platinum", balance: 10 });
    renderShop();
    await userEvent.click(await screen.findByRole("button", { name: /re-roll/i }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Alice Ace: Gold → Platinum"));
  });
});

describe("the price table", () => {
  it("is closed by default, with its rungs still in the DOM", () => {
    renderShop();
    const summary = screen.getByText(/where dust comes from/i);
    const details = summary.closest("details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    // Closed content stays in the DOM (that is what a native disclosure is).
    expect(details.textContent).toContain("Mythic");
    expect(details.textContent).toContain("Common");
    // And it is still reachable as a heading.
    expect(screen.getByRole("heading", { name: /where dust comes from/i })).toBeTruthy();
  });

  it("opens on click", async () => {
    renderShop();
    const details = screen
      .getByText(/where dust comes from/i)
      .closest("details") as HTMLDetailsElement;
    await userEvent.click(screen.getByText(/where dust comes from/i));
    expect(details.open).toBe(true);
  });
});

describe("the bonus pull caption", () => {
  it("is one line: the shortfall and the free-pull fact together when short", () => {
    renderShop(DUST_PRICES.bonusPull - 30);
    expect(screen.getByText("30 more to go · doesn't touch tomorrow's free one")).toBeTruthy();
    expect(screen.queryByText("Doesn't touch tomorrow's free one.")).toBeNull();
  });

  it("drops the shortfall once affordable", () => {
    renderShop();
    expect(screen.getByText("Doesn't touch tomorrow's free one.")).toBeTruthy();
    expect(screen.queryByText(/more to go/)).toBeNull();
  });
});

describe("the intros", () => {
  it("keeps the facts that must be seen without a tap", () => {
    renderShop();
    expect(screen.getByText(/you always keep one/i)).toBeTruthy();
    expect(screen.getByText(/includes your only copy/i)).toBeTruthy();
    expect(screen.getByText(/it can go down/i)).toBeTruthy();
    expect(screen.getByText(/doesn't touch tomorrow's free one/i)).toBeTruthy();
  });
});
