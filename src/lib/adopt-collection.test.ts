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

const addUnrecorded = vi.fn();
const retireUnrecorded = vi.fn();
vi.mock("./card-collection", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./card-collection")>()),
  addUnrecorded: (...args: unknown[]) => addUnrecorded(...args),
  retireUnrecorded: (...args: unknown[]) => retireUnrecorded(...args),
}));

const { adoptLocalCollection, adoptableIds, holdForAdoption, releaseAdoptionHold } =
  await import("./adopt-collection");

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
  addUnrecorded.mockReset().mockResolvedValue(undefined);
  retireUnrecorded.mockReset().mockResolvedValue(undefined);
  adoptCollection.mockReset();
  adoptCollection.mockResolvedValue({ ok: true, adopted: 1 });
});

describe("adoptLocalCollection", () => {
  it("files every card, in batches the handler will accept", async () => {
    const snapshot = snapshotOf(150);
    await adoptLocalCollection(snapshot);

    const batches = adoptCollection.mock.calls.map(
      ([arg]) =>
        (arg as { data: { eventParticipantIds: string[] } }).data.eventParticipantIds.length,
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

describe("holding the cards while the adoption is in the air", () => {
  it("files every card under the member the handset is about to become", async () => {
    const snapshot = snapshotOf(3);
    await holdForAdoption("p-doug", snapshot);
    expect(addUnrecorded).toHaveBeenCalledWith({
      dayKey: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      identity: "m:p-doug",
      ids: Object.keys(snapshot),
    });
  });

  it("holds nothing for a handset that holds nothing", async () => {
    await holdForAdoption("p-doug", {});
    expect(addUnrecorded).not.toHaveBeenCalled();
  });

  it("lets go only after the stats refetch has landed", async () => {
    // The cached answer from before the adoption is the empty one; dropping the
    // hold while it is still the freshest word hands the prune the cards.
    const order: string[] = [];
    const refetchQueries = vi.fn(async () => {
      order.push("refetch");
    });
    retireUnrecorded.mockImplementation(async () => {
      order.push("retire");
    });
    await releaseAdoptionHold(snapshotOf(2), { refetchQueries } as never);

    expect(order).toEqual(["refetch", "retire"]);
    expect(refetchQueries).toHaveBeenCalledWith(
      { queryKey: ["my-card-stats"], type: "active" },
      { throwOnError: true },
    );
    expect(retireUnrecorded).toHaveBeenCalledWith(["card-000", "card-001"]);
  });

  it("keeps the hold when the refetch fails", async () => {
    // Keeping it costs nothing; letting go while the cached answer is the empty
    // one loses the card.
    const refetchQueries = vi.fn().mockRejectedValue(new Error("offline"));
    await expect(releaseAdoptionHold(snapshotOf(2), { refetchQueries } as never)).rejects.toThrow(
      "offline",
    );
    expect(retireUnrecorded).not.toHaveBeenCalled();
  });

  it("lets go at once when there is no refetch to wait for", async () => {
    await releaseAdoptionHold(snapshotOf(2));
    expect(retireUnrecorded).toHaveBeenCalledWith(["card-000", "card-001"]);
  });
});
