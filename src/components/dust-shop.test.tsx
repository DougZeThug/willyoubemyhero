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
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createQueryWrapper } from "@/test/query";
import { mySecretsKey } from "@/hooks/use-daily-secret";
import { packStatusKey } from "@/hooks/use-pack-status";
import { collectionTrophiesKey } from "@/hooks/use-collection-trophies";
import { dustBalanceKey } from "@/hooks/use-dust";
import { tradeSparesKey } from "@/hooks/use-trades";
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
        actor={ACTOR}
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

describe("narrow-phone layout", () => {
  it("lets the secret row's meta line wrap and keeps the set chip from shrinking", async () => {
    // jsdom has no layout, so the class strings are the honest assertion: at 320
    // this line ran under the Sell button and squeezed the chip to a letter.
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
    expect(last.parentElement?.className).toMatch(/\bflex-wrap\b/);
    const chip = screen.getByText("Cornhole Collection");
    expect(chip.className).toMatch(/\bshrink-0\b/);
  });

  it("keeps a gap between each ladder label and its number", () => {
    renderShop();
    const row = screen.getByText("Platinum").closest("li");
    expect(row?.className).toMatch(/\bgap-2\b/);
    // And the table gives the wider level column its room on a narrow phone.
    expect(row?.parentElement?.parentElement?.className).toMatch(
      /grid-cols-\[auto_minmax\(0,1fr\)\]/,
    );
    const secretRow = screen.getByText("Legendary").closest("li");
    expect(secretRow?.className).toMatch(/\bgap-2\b/);
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

describe("the intros", () => {
  it("keeps the facts that must be seen without a tap", () => {
    renderShop();
    expect(screen.getByText(/you always keep one/i)).toBeTruthy();
    expect(screen.getByText(/includes your only copy/i)).toBeTruthy();
    expect(screen.getByText(/it can go down/i)).toBeTruthy();
    expect(screen.getByText(/doesn't touch tomorrow's free one/i)).toBeTruthy();
  });
});
