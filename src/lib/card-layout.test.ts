// The slot layout that puts live numbers on top of frozen card art.
//
// parseCardLayout is the trust boundary — it reads jsonb straight out of the
// database and JSON straight off the wire — so most of what matters here is
// what it does with input that is wrong rather than what it does with input
// that is right.
import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_ASPECT,
  EMPTY_SLOT_STATS,
  defaultLayout,
  layoutMap,
  parseCardLayout,
  readLayoutColumn,
  resolveSlot,
  type SlotContext,
} from "./card-layout";
import { attributeMap } from "./card-attributes";
import { cardStats } from "./card-stats";
import { makeFieldBundle, resetFixtureIds } from "@/test/fixtures";

beforeEach(resetFixtureIds);

const SLOT = { id: "a", key: "ovr", x: 0.1, y: 0.2, w: 0.3, h: 0.1, size: 0.09, align: "center" };
const LAYOUT = { version: 1, aspect: DEFAULT_ASPECT, slots: [SLOT] };

describe("parseCardLayout", () => {
  it("reads a well-formed layout back unchanged", () => {
    const parsed = parseCardLayout(LAYOUT)!;
    expect(parsed.slots).toHaveLength(1);
    expect(parsed.slots[0]).toMatchObject({ id: "a", key: "ovr", x: 0.1, align: "center" });
  });

  it("returns null for anything that is not a layout", () => {
    for (const junk of [null, undefined, 7, "layout", [], {}, { slots: "nope" }]) {
      expect(parseCardLayout(junk)).toBeNull();
    }
  });

  it("treats a layout with no drawable slots as no layout at all", () => {
    expect(parseCardLayout({ version: 1, slots: [] })).toBeNull();
    expect(parseCardLayout({ version: 1, slots: [{ key: "salary" }] })).toBeNull();
  });

  it("drops a slot bound to a stat that does not exist", () => {
    const parsed = parseCardLayout({ ...LAYOUT, slots: [SLOT, { id: "b", key: "salary" }] })!;
    expect(parsed.slots.map((s) => s.key)).toEqual(["ovr"]);
  });

  it("clamps coordinates into the card", () => {
    const parsed = parseCardLayout({
      ...LAYOUT,
      slots: [{ ...SLOT, x: -3, y: 9, w: 4, h: 4 }],
    })!;
    const slot = parsed.slots[0];
    expect(slot.x).toBe(0);
    expect(slot.y).toBe(1);
    expect(slot.x + slot.w).toBeLessThanOrEqual(1);
    expect(slot.y + slot.h).toBeLessThanOrEqual(1);
  });

  it("keeps a box off the edge from swallowing the whole card", () => {
    const parsed = parseCardLayout({ ...LAYOUT, slots: [{ ...SLOT, x: 0.8, w: 1 }] })!;
    expect(parsed.slots[0].w).toBeCloseTo(0.2);
  });

  it("bounds the type size, so one bad number cannot fill the card", () => {
    expect(parseCardLayout({ ...LAYOUT, slots: [{ ...SLOT, size: 99 }] })!.slots[0].size).toBe(0.5);
    expect(parseCardLayout({ ...LAYOUT, slots: [{ ...SLOT, size: -1 }] })!.slots[0].size).toBe(
      0.01,
    );
  });

  it("falls back to centre for an alignment it does not know", () => {
    expect(parseCardLayout({ ...LAYOUT, slots: [{ ...SLOT, align: "sideways" }] })!.slots[0].align) //
      .toBe("center");
  });

  it("drops a duplicate id rather than rendering two nodes with one key", () => {
    const parsed = parseCardLayout({ ...LAYOUT, slots: [SLOT, { ...SLOT, key: "speed" }] })!;
    expect(parsed.slots).toHaveLength(1);
  });

  it("ignores a plate with no colour", () => {
    expect(parseCardLayout({ ...LAYOUT, slots: [{ ...SLOT, plate: {} }] })!.slots[0].plate).toBeNull(); // prettier-ignore
    expect(
      parseCardLayout({ ...LAYOUT, slots: [{ ...SLOT, plate: 4 }] })!.slots[0].plate,
    ).toBeNull();
  });

  it("keeps a plate that has one", () => {
    const parsed = parseCardLayout({
      ...LAYOUT,
      slots: [{ ...SLOT, plate: { color: "rgb(12 20 30)", radius: 0.03 } }],
    })!;
    expect(parsed.slots[0].plate).toEqual({ color: "rgb(12 20 30)", radius: 0.03 });
  });

  it("caps how many slots one layout can carry", () => {
    const slots = Array.from({ length: 60 }, (_, i) => ({ ...SLOT, id: `s${i}` }));
    expect(parseCardLayout({ ...LAYOUT, slots })!.slots).toHaveLength(32);
  });

  it("substitutes a sane aspect for a nonsense one", () => {
    expect(parseCardLayout({ ...LAYOUT, aspect: 0 })!.aspect).toBe(DEFAULT_ASPECT);
    expect(parseCardLayout({ ...LAYOUT, aspect: 500 })!.aspect).toBe(3);
  });
});

describe("defaultLayout", () => {
  it("survives its own parser", () => {
    const parsed = parseCardLayout(defaultLayout())!;
    expect(parsed.slots).toHaveLength(defaultLayout().slots.length);
  });

  it("keeps every slot inside the card", () => {
    for (const slot of defaultLayout().slots) {
      expect(slot.x + slot.w).toBeLessThanOrEqual(1);
      expect(slot.y + slot.h).toBeLessThanOrEqual(1);
    }
  });
});

describe("layoutMap", () => {
  const eventRow = { card_layout: LAYOUT };

  it("gives every participant the event layout by default", () => {
    const map = layoutMap([{ id: "p1" }, { id: "p2" }], eventRow);
    expect(map.get("p1")?.slots[0].key).toBe("ovr");
    expect(map.get("p2")?.slots[0].key).toBe("ovr");
  });

  it("lets a player's own layout win", () => {
    const own = { ...LAYOUT, slots: [{ ...SLOT, key: "time" }] };
    const map = layoutMap([{ id: "p1", card_layout: own }, { id: "p2" }], eventRow);
    expect(map.get("p1")?.slots[0].key).toBe("time");
    expect(map.get("p2")?.slots[0].key).toBe("ovr");
  });

  it("resolves to null when neither exists, which is plain artwork", () => {
    expect(layoutMap([{ id: "p1" }], null).get("p1")).toBeNull();
  });

  it("falls back to the event layout when a player's own is unusable", () => {
    const map = layoutMap([{ id: "p1", card_layout: { slots: [] } }], eventRow);
    expect(map.get("p1")?.slots[0].key).toBe("ovr");
  });

  it("is empty without a roster", () => {
    expect(layoutMap(null, eventRow).size).toBe(0);
  });
});

describe("readLayoutColumn", () => {
  it("reads the column off a row the generated types do not know about", () => {
    expect(readLayoutColumn({ id: "x", card_layout: LAYOUT })).toBe(LAYOUT);
  });

  it("is null for a row without one", () => {
    expect(readLayoutColumn({ id: "x" })).toBeNull();
    expect(readLayoutColumn(null)).toBeNull();
  });
});

describe("resolveSlot", () => {
  function contextFor(which: "alice" | "dave"): SlotContext {
    const field = makeFieldBundle();
    const ep = field[which];
    return {
      attributes: attributeMap(field.bundle).get(ep.id) ?? null,
      stats: cardStats(field.bundle, ep.participant_id),
      name: ep.participant?.name ?? "—",
      bib: which === "alice" ? 7 : null,
      pick: which === "alice" ? 2 : null,
      rarityLabel: "1 of 1",
    };
  }

  it("prints the ratings and the real numbers alike", () => {
    const ctx = contextFor("alice");
    expect(resolveSlot("ovr", ctx)).toMatch(/^\d+$/);
    expect(resolveSlot("speed", ctx)).toBe("99");
    expect(resolveSlot("time", ctx)).toBe("50.00");
    expect(resolveSlot("rank", ctx)).toBe("#1");
    expect(resolveSlot("bib", ctx)).toBe("7");
    expect(resolveSlot("pick", ctx)).toBe("#2");
    expect(resolveSlot("tier", ctx)).toBe("1 of 1");
    expect(resolveSlot("name", ctx)).toBe("Alice");
  });

  it("names the station a player won", () => {
    const field = makeFieldBundle();
    const ctx: SlotContext = {
      attributes: attributeMap(field.bundle).get(field.carol.id) ?? null,
      stats: cardStats(field.bundle, field.carol.participant_id),
      name: "Carol",
      bib: null,
      pick: null,
      rarityLabel: "Station King",
    };
    expect(resolveSlot("bestStation", ctx)).toBe("SLED");
  });

  it("dashes every missing value rather than printing null", () => {
    const ctx = contextFor("dave");
    for (const key of ["ovr", "speed", "time", "rank", "bib", "pick", "bestStation"] as const) {
      expect(resolveSlot(key, ctx)).toBe("—");
    }
  });

  it("never returns an empty string, which would show the art underneath", () => {
    const ctx = contextFor("dave");
    for (const key of ["ovr", "speed", "time", "rank", "tier", "name"] as const) {
      expect(resolveSlot(key, ctx).length).toBeGreaterThan(0);
    }
  });

  it("still resolves the overall against the empty stats the vault grid passes", () => {
    const field = makeFieldBundle();
    const ctx: SlotContext = {
      attributes: attributeMap(field.bundle).get(field.alice.id) ?? null,
      stats: EMPTY_SLOT_STATS,
      name: "Alice",
      bib: null,
      pick: null,
      rarityLabel: "1 of 1",
    };
    expect(resolveSlot("ovr", ctx)).toMatch(/^\d+$/);
  });
});
