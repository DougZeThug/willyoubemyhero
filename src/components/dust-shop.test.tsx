// The dust shop's cache bookkeeping.
//
// Not the sheet's looks — the keys it invalidates. Every query this component
// has to refresh after a purchase is registered somewhere else, on a key spelled
// somewhere else, and getting that string wrong fails silently: the mutation
// succeeds, the toast fires, and the screen keeps showing the old world. That is
// exactly what happened here, so the keys are pinned rather than the prose.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createQueryWrapper } from "@/test/query";
import { mySecretsKey, secretStatusKey } from "@/hooks/use-daily-secret";
import { collectionTrophiesKey } from "@/hooks/use-collection-trophies";
import { dustBalanceKey } from "@/hooks/use-dust";
import { DUST_PRICES } from "@/lib/dust";
import { DustShop } from "./dust-shop";

const ME = "11111111-1111-4111-8111-111111111111";
const ACTOR = `m:${ME}`;
const EVENT = "22222222-2222-4222-8222-222222222222";

const buyFn = vi.hoisted(() => vi.fn());
const millFn = vi.hoisted(() => vi.fn());
const sparesFn = vi.hoisted(() => vi.fn());

// The server functions are replaced by sentinels so useServerFn can tell which
// one it was handed. The component binds all of them at render, and a real
// createServerFn would try to reach the network.
vi.mock("@/lib/dust.functions", () => ({
  buyBonusSecretPull: "fn:buy",
  millCardCopy: "fn:mill",
  rerollCopyEdition: "fn:reroll",
}));

vi.mock("@/lib/trades.functions", () => ({ getTradeSpares: "fn:spares" }));

vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: unknown) =>
    ({ "fn:buy": buyFn, "fn:mill": millFn, "fn:spares": sparesFn })[fn as string] ?? buyFn,
}));

vi.mock("sonner", () => ({ toast: vi.fn() }));

function renderShop() {
  const { wrapper, client } = createQueryWrapper();
  const invalidate = vi.spyOn(client, "invalidateQueries") as unknown as Invalidate;
  const Wrapper = wrapper;
  render(
    <Wrapper>
      <DustShop
        open
        onOpenChange={() => {}}
        balance={DUST_PRICES.bonusPull}
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
  sparesFn.mockResolvedValue({ participantId: ME, roster: [], secrets: [], blocked: [] });
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
    expect(seen).toContain(JSON.stringify(secretStatusKey(ACTOR)));
    expect(seen).toContain(JSON.stringify(mySecretsKey(ACTOR)));
    // And never the bare id, which is the shape that silently matched nothing.
    expect(seen).not.toContain(JSON.stringify(secretStatusKey(ME)));
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
    expect(keys(invalidate)).not.toContain(JSON.stringify(secretStatusKey(ACTOR)));
    expect(client.getQueryData(dustBalanceKey(ME))).toBeUndefined();
  });
});
