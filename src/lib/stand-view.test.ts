// What the reveal stand reads off the slot it is on — walked branch by branch,
// since the reason it was lifted out of the component is that a test can.
import { describe, expect, it } from "vitest";
import type { StandSlot } from "@/components/pack-stand";
import { rarityStyle } from "@/lib/card-rarity";
import type { PackRosterSlot, PackSecretSlot } from "@/lib/pack";
import { upgradeLabel } from "@/lib/pack-outcome";
import {
  exitVariants,
  FLIP_MS,
  flipMsFor,
  gatheredInitial,
  resolveStand,
  SECRET_FLIP_MS,
  steppedInitial,
} from "./stand-view";

const EP = {
  id: "ep-1",
  participant_id: "p-1",
  running_order: 1,
  bib_number: 1,
  selected_draft_position: null,
  participant: { name: "Alice Ace" },
};

function roster(
  over: Omit<Partial<StandSlot>, "slot"> & { slot?: Partial<PackRosterSlot> } = {},
): StandSlot {
  const { slot, ...rest } = over;
  return {
    slot: {
      kind: "roster",
      id: "ep-1",
      edition: "standard",
      heldBefore: 0,
      editionBefore: null,
      ...slot,
    },
    rarity: rarityStyle("podium"),
    edition: "gold",
    outcome: "new",
    copies: 1,
    sellValue: null,
    ep: EP,
    ...rest,
  };
}

function secret(
  over: Omit<Partial<StandSlot>, "slot"> & { slot?: Partial<PackSecretSlot> } = {},
): StandSlot {
  const { slot, ...rest } = over;
  return {
    slot: {
      kind: "secret",
      id: "sec-1",
      card: { id: "sec-1", name: "Pickles", flavour: null, foil: "rosette", borderFx: "spin", collection: null, artUrl: null, backUrl: null, tier: "common" }, // prettier-ignore
      duplicate: false,
      tierBefore: null,
      completedCollection: null,
      ...slot,
    },
    rarity: rarityStyle("base"),
    // Set on purpose: a secret must ignore it, not merely be handed null.
    edition: "gold",
    outcome: "new",
    copies: 1,
    sellValue: null,
    ep: null,
    ...rest,
  };
}

describe("flipMsFor", () => {
  it("gives a roster card the house speed and a secret its own", () => {
    expect(flipMsFor(false)).toBe(FLIP_MS);
    expect(flipMsFor(true)).toBe(SECRET_FLIP_MS);
  });

  it("keeps the secret's turn more than twice the roster's, as documented", () => {
    expect(SECRET_FLIP_MS).toBeGreaterThan(FLIP_MS * 2);
  });
});

describe("resolveStand", () => {
  it("answers for an empty pack without throwing", () => {
    const view = resolveStand();
    expect(view.onSecret).toBe(false);
    expect(view.ep).toBeNull();
    expect(view.secret).toBeNull();
    expect(view.rarity).toEqual(rarityStyle("base"));
    expect(view.edition).toBeNull();
    expect(view.name).toBe("—");
    // Unknown is quiet: a duplicate prints nothing on the ribbon.
    expect(view.outcome).toBe("duplicate");
    expect(view.isDupe).toBe(true);
    expect(view.standCopies).toBeNull();
    expect(view.climbed).toBeNull();
  });

  it("reads a roster slot off the roster row", () => {
    const slot = roster();
    const view = resolveStand(slot);
    expect(view.onSecret).toBe(false);
    expect(view.ep).toBe(EP);
    expect(view.secret).toBeNull();
    expect(view.rarity).toBe(slot.rarity);
    expect(view.edition).toBe("gold");
    expect(view.name).toBe("Alice Ace");
    expect(view.outcome).toBe("new");
    expect(view.isDupe).toBe(false);
    expect(view.standCopies).toBe(1);
    expect(view.climbed).toBeNull();
  });

  it("keeps a finish that is not decided as null rather than standard", () => {
    expect(resolveStand(roster({ edition: null })).edition).toBeNull();
  });

  it("falls back to a dash for a roster row with no name", () => {
    expect(resolveStand(roster({ ep: { ...EP, participant: null } })).name).toBe("—");
    expect(resolveStand(roster({ ep: { ...EP, participant: { name: null } } })).name).toBe("—");
    expect(resolveStand(roster({ ep: null })).name).toBe("—");
  });

  it("reads a secret off the card and never wears an edition frame", () => {
    const slot = secret();
    const view = resolveStand(slot);
    expect(view.onSecret).toBe(true);
    expect(view.ep).toBeNull();
    expect(view.secret).toBe((slot.slot as PackSecretSlot).card);
    expect(view.edition).toBeNull();
    expect(view.name).toBe("Pickles");
  });

  it("says a plain duplicate is a duplicate and a first is not", () => {
    expect(resolveStand(roster({ outcome: "duplicate" })).isDupe).toBe(true);
    expect(resolveStand(roster({ outcome: "new" })).isDupe).toBe(false);
    expect(resolveStand(roster({ outcome: "upgrade" })).isDupe).toBe(false);
  });

  it("names the rung climbed only for an upgrade", () => {
    const up = roster({ outcome: "upgrade", slot: { edition: "gold", editionBefore: "bronze" } });
    const climbed = resolveStand(up).climbed;
    expect(climbed).not.toBeNull();
    expect(climbed).toEqual(upgradeLabel(up.slot));

    // The same slot as a duplicate or a first has no climb to announce.
    expect(resolveStand({ ...up, outcome: "duplicate" }).climbed).toBeNull();
    expect(resolveStand({ ...up, outcome: "new" }).climbed).toBeNull();
  });

  it("names a secret's climb through its level", () => {
    const up = secret({ outcome: "upgrade", slot: { duplicate: true, tierBefore: "common" } });
    expect(resolveStand(up).climbed).toEqual(upgradeLabel(up.slot));
  });

  it("passes the copy count through, and null stays null", () => {
    expect(resolveStand(roster({ copies: 3 })).standCopies).toBe(3);
    expect(resolveStand(roster({ copies: null })).standCopies).toBeNull();
  });
});

describe("gatheredInitial", () => {
  it("fades in on the spot when the ceremony handed the deck over", () => {
    expect(gatheredInitial(false)).toEqual({ opacity: 0, x: 0, scale: 0.94 });
  });

  it("does not shrink the handed-over card under reduced motion", () => {
    expect(gatheredInitial(true)).toEqual({ opacity: 0, x: 0, scale: 1 });
  });
});

describe("steppedInitial", () => {
  it("slides in from the right when stepping on", () => {
    expect(steppedInitial(false)).toEqual({ opacity: 0, x: 64, scale: 0.94 });
  });

  it("does not slide under reduced motion", () => {
    expect(steppedInitial(true)).toEqual({ opacity: 0, x: 0, scale: 0.94 });
  });
});

describe("exitVariants", () => {
  const out = (reduced: boolean, x: number) =>
    (exitVariants(reduced).out as (x: number) => unknown)(x);

  it("leaves to wherever the finger left the card", () => {
    expect(out(false, -120)).toEqual({ opacity: 0, x: -120, scale: 0.94 });
  });

  it("stays put under reduced motion", () => {
    expect(out(true, -120)).toEqual({ opacity: 0, x: 0, scale: 0.94 });
  });
});
