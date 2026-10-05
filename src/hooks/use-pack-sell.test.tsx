// Selling a card straight off the pack screen.
//
// What is pinned: which row each kind of slot sells (a secret by the pull the
// pack dealt, a roster card by a copy at the finish the button priced), that a
// refusal comes back as a line rather than a throw, and that a sale refreshes
// exactly what the dust shop refreshes — keyed on the actor where those caches
// are keyed on the actor.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { createQueryWrapper } from "@/test/query";
import type { PackRosterSlot, PackSecretSlot } from "@/lib/pack";

const fns = vi.hoisted(() => ({
  mill: vi.fn(),
  sell: vi.fn(),
  spares: vi.fn(),
}));
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: unknown) => fn,
}));
vi.mock("@/lib/dust.functions", () => ({
  millCardCopy: fns.mill,
  sellSecretCard: fns.sell,
}));
vi.mock("@/lib/trades.functions", () => ({ getTradeSpares: fns.spares }));

import { usePackSell } from "./use-pack-sell";
import { dustBalanceKey } from "./use-dust";
import { mySecretsKey } from "./use-daily-secret";
import { packStatusKey } from "./use-pack-status";
import { tradeSparesKey } from "./use-trades";

const ME = "me-1";
const ACTOR = `m:${ME}`;
const EVENT = "ev-1";

const rosterSlot: PackRosterSlot = {
  kind: "roster",
  id: "ep-1",
  edition: "gold",
  heldBefore: 1,
  editionBefore: "standard",
};
const secretSlot = (over: Partial<PackSecretSlot> = {}): PackSecretSlot => ({
  kind: "secret",
  id: "sec-1",
  pullId: "pull-today",
  card: { tier: "rare" } as never,
  duplicate: true,
  tierBefore: "common",
  completedCollection: null,
  ...over,
});

const spare = (copyId: string, edition: string, over: Record<string, unknown> = {}) => ({
  copyId,
  eventParticipantId: "ep-1",
  edition,
  assertedBy: "server",
  viewerOwns: true,
  ...over,
});

function mount(participantId: string | null = ME) {
  const { wrapper, client } = createQueryWrapper();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const { result } = renderHook(() => usePackSell(ACTOR, participantId, EVENT), { wrapper });
  const keys = () => invalidate.mock.calls.map(([f]) => JSON.stringify(f?.queryKey));
  return { sell: result.current, client, keys };
}

beforeEach(() => {
  fns.mill.mockReset();
  fns.sell.mockReset();
  fns.spares.mockReset();
});

describe("a secret", () => {
  it("sells the very pull the pack dealt", async () => {
    fns.sell.mockResolvedValue({ ok: true, awarded: 60, balance: 160 });
    const { sell, client, keys } = mount();

    await expect(sell(secretSlot(), null)).resolves.toEqual({ ok: true, awarded: 60 });
    expect(fns.sell).toHaveBeenCalledWith({ data: { secretPullId: "pull-today" } });
    expect(client.getQueryData(dustBalanceKey(ME))).toEqual({ balance: 160 });
    expect(keys()).toContain(JSON.stringify(mySecretsKey(ACTOR)));
    expect(keys()).toContain(JSON.stringify(packStatusKey(ACTOR)));
    expect(keys()).toContain(JSON.stringify(tradeSparesKey(ME)));
    expect(keys()).toContain(JSON.stringify(["dust-spares", ME]));
  });

  it("says a copy that already left is gone, and refreshes nothing", async () => {
    // The pack replays all day, so a secret sold an hour ago is still on it.
    fns.sell.mockResolvedValue({ ok: false, reason: "not_yours" });
    const { sell, client, keys } = mount();

    await expect(sell(secretSlot(), null)).resolves.toEqual({
      ok: false,
      message: "Already gone — it left your vault",
    });
    expect(client.getQueryData(dustBalanceKey(ME))).toBeUndefined();
    expect(keys()).toEqual([]);
  });

  it("sells nothing for a slot with no pull to sell", async () => {
    const { sell } = mount();
    const res = await sell(secretSlot({ pullId: undefined }), null);
    expect(res.ok).toBe(false);
    expect(fns.sell).not.toHaveBeenCalled();
  });
});

describe("a roster card", () => {
  it("burns the copy today's pack minted, and no other", async () => {
    fns.spares.mockResolvedValue({
      ownedRoster: [
        spare("c-old-gold", "gold"),
        spare("c-gold", "gold", { pulledToday: true }),
        spare("c-standard", "standard"),
      ],
    });
    fns.mill.mockResolvedValue({ ok: true, awarded: 40, balance: 90 });
    const { sell, client } = mount();

    await expect(sell(rosterSlot, "gold")).resolves.toEqual({ ok: true, awarded: 40 });
    expect(fns.spares).toHaveBeenCalledWith({ data: { participantId: ME } });
    expect(fns.mill).toHaveBeenCalledWith({ data: { cardCopyId: "c-gold" } });
    expect(client.getQueryData(dustBalanceKey(ME))).toEqual({ balance: 90 });
  });

  it("says today's copy is gone rather than burn an older one at the same finish", async () => {
    // The replayed pack after a reload: the receipt is lost with the page, and
    // today's gold already went. Another gold is not what this slot dealt, and
    // burning it would let every reload-and-confirm sell one more copy.
    fns.spares.mockResolvedValue({ ownedRoster: [spare("c-old-gold", "gold"), spare("c-std", "standard")] }); // prettier-ignore
    const { sell } = mount();

    const res = await sell(rosterSlot, "gold");
    expect(res).toEqual({ ok: false, message: "Already gone — it left your vault" });
    expect(fns.mill).not.toHaveBeenCalled();
  });

  it("tells a member their last copy is their last, not that it is gone", async () => {
    // A card held once is absent from `roster` (duplicates only) and present in
    // `ownedRoster`. Searching the first made today's pull "Already gone — it left
    // your vault" the moment it became the only copy, which is false: it is right
    // there. The RPC owns the rule, so the copy is found and the RPC is asked.
    fns.spares.mockResolvedValue({
      roster: [],
      ownedRoster: [spare("c-gold", "gold", { pulledToday: true })],
    });
    fns.mill.mockResolvedValue({ ok: false, reason: "last_copy" });
    const { sell } = mount();

    await expect(sell(rosterSlot, "gold")).resolves.toEqual({
      ok: false,
      message: "That's your last one",
    });
    expect(fns.mill).toHaveBeenCalledWith({ data: { cardCopyId: "c-gold" } });
  });

  it("refuses today's copy once its finish has been re-rolled", async () => {
    // The button still quotes gold; the copy is a silver now.
    fns.spares.mockResolvedValue({ ownedRoster: [spare("c-today", "silver", { pulledToday: true })] }); // prettier-ignore
    const { sell } = mount();

    const res = await sell(rosterSlot, "gold");
    expect(res.ok).toBe(false);
    expect(fns.mill).not.toHaveBeenCalled();
  });

  it("turns a failed request into a line to show, not a throw", async () => {
    fns.spares.mockRejectedValue(new Error("offline"));
    const { sell } = mount();
    await expect(sell(rosterSlot, "gold")).resolves.toEqual({
      ok: false,
      message: "Couldn't sell it — try again",
    });
  });
});

it("sells nothing for somebody who is not a member", async () => {
  const { sell } = mount(null);
  const res = await sell(secretSlot(), null);
  expect(res.ok).toBe(false);
  expect(fns.sell).not.toHaveBeenCalled();
});
