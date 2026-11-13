import { describe, expect, it } from "vitest";
import { buildStandSlots } from "./pack-stand-slots";
import { MILL_BY_EDITION } from "./dust";
import type { PackRosterSlot } from "./pack";

const slot = (over: Partial<PackRosterSlot> = {}): PackRosterSlot => ({
  kind: "roster",
  id: "ep-1",
  edition: "standard",
  heldBefore: 1,
  editionBefore: "standard",
  ...over,
});

const base = {
  participants: [],
  rarities: new Map(),
  localBefore: {},
  mySecrets: { data: undefined, fetching: false, errored: false },
  mySpares: { data: undefined, fetching: false, errored: false },
  sold: {},
  pricing: true,
};

describe("buildStandSlots", () => {
  it("is empty before anything is dealt", () => {
    expect(buildStandSlots({ ...base, slots: null })).toEqual([]);
  });

  it("counts a duplicate against the collection as it stood at the deal", () => {
    const [row] = buildStandSlots({ ...base, slots: [slot({ heldBefore: 2 })] });
    expect(row.copies).toBe(3);
  });

  it("prices a duplicate only while dust pricing is on", () => {
    const slots = [slot({ heldBefore: 1 })];
    expect(buildStandSlots({ ...base, slots })[0].sellValue).toBe(MILL_BY_EDITION.standard);
    expect(buildStandSlots({ ...base, slots, pricing: false })[0].sellValue).toBeNull();
  });

  it("reports what a sale left behind and stops quoting a price for it", () => {
    const [row] = buildStandSlots({
      ...base,
      slots: [slot({ heldBefore: 1 })],
      sold: { 0: { awarded: 5, copies: 1 } },
    });
    expect(row.copies).toBe(1);
    expect(row.held).toBeNull();
    expect(row.sellValue).toBeNull();
  });
});
