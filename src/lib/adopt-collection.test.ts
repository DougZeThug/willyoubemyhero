// Filing a handset's cards against the identity it has just become.
//
// The store spans every event the phone has ever played and is never emptied,
// so the size of one call is not the size of the job. A cap here used to drop
// the overflow, and the reconcile that follows sign-in deleted exactly those
// cards.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CollectedCard } from "./card-collection";

const adoptCollection = vi.fn();
vi.mock("./card-pulls.functions", () => ({
  adoptCollection: (...args: unknown[]) => adoptCollection(...args),
}));

const { adoptLocalCollection, adoptableIds } = await import("./adopt-collection");

function snapshotOf(n: number): Record<string, CollectedCard> {
  const out: Record<string, CollectedCard> = {};
  for (let i = 0; i < n; i++) {
    const id = `card-${String(i).padStart(3, "0")}`;
    out[id] = { eventParticipantId: id, pulledAt: 1, count: 1, tier: "base", edition: "standard" };
  }
  return out;
}

function sentIds(): string[] {
  return adoptCollection.mock.calls.flatMap(
    ([arg]) => (arg as { data: { eventParticipantIds: string[] } }).data.eventParticipantIds,
  );
}

beforeEach(() => {
  adoptCollection.mockReset();
  adoptCollection.mockResolvedValue({ ok: true, adopted: 1 });
});

describe("adoptLocalCollection", () => {
  it("files every card, in batches the handler will accept", async () => {
    const snapshot = snapshotOf(150);
    await adoptLocalCollection(snapshot);

    const batches = adoptCollection.mock.calls.map(
      ([arg]) => (arg as { data: { eventParticipantIds: string[] } }).data.eventParticipantIds
        .length,
    );
    expect(batches).toEqual([64, 64, 22]);
    expect(sentIds()).toEqual(Object.keys(snapshot));
    expect(new Set(sentIds()).size).toBe(150);
  });

  it("counts what every batch filed, not just the last", async () => {
    adoptCollection
      .mockResolvedValueOnce({ ok: true, adopted: 64 })
      .mockResolvedValueOnce({ ok: true, adopted: 10 });
    expect(await adoptLocalCollection(snapshotOf(70))).toBe(74);
  });

  it("says nothing to the server when the handset holds nothing", async () => {
    expect(await adoptLocalCollection({})).toBe(0);
    expect(adoptCollection).not.toHaveBeenCalled();
  });
});

describe("adoptableIds", () => {
  it("names every card the handset holds, past the size of one call", () => {
    const ids = adoptableIds(snapshotOf(150));
    expect(ids).toHaveLength(150);
    expect(ids).toContain("card-149");
  });
});
