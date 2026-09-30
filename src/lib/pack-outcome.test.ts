// What a slot means to the person turning it — exhaustively, since the whole
// point of lifting it out of the route is that every branch can be walked.
import { describe, expect, it } from "vitest";
import {
  celebrationFor,
  copiesAfter,
  peekMs,
  PEEK_MS,
  rosterOutcome,
  SECRET_PEEK_MS,
  SECRET_RISER_AT_MS,
  secretOutcome,
  slotOutcome,
  upgradeLabel,
} from "./pack-outcome";
import type { PackRosterSlot, PackSecretSlot } from "./pack";

const roster = (over: Partial<PackRosterSlot> = {}): PackRosterSlot => ({
  kind: "roster",
  id: "ep-1",
  edition: "standard",
  heldBefore: 0,
  editionBefore: null,
  ...over,
});

const secret = (over: Partial<PackSecretSlot> = {}): PackSecretSlot => ({
  kind: "secret",
  id: "s-1",
  card: {
    id: "s-1",
    name: "Gary the Grill",
    flavour: null,
    foil: "rosette",
    borderFx: "spin",
    collection: null,
    artUrl: null,
    backUrl: null,
    tier: "rare",
  },
  duplicate: false,
  tierBefore: null,
  completedCollection: null,
  ...over,
});

describe("rosterOutcome", () => {
  it("is new when nothing was held", () => {
    expect(rosterOutcome({ heldBefore: 0, editionBefore: null, edition: "standard" })).toBe("new");
  });

  it("is an upgrade when the finish beats the best copy held", () => {
    expect(rosterOutcome({ heldBefore: 1, editionBefore: "standard", edition: "gold" })).toBe("upgrade"); // prettier-ignore
    expect(rosterOutcome({ heldBefore: 2, editionBefore: "silver", edition: "platinum" })).toBe("upgrade"); // prettier-ignore
  });

  it("measures against standard when the copy held carries no finish", () => {
    expect(rosterOutcome({ heldBefore: 1, editionBefore: null, edition: "bronze" })).toBe(
      "upgrade",
    );
    expect(rosterOutcome({ heldBefore: 1, editionBefore: undefined, edition: "standard" })).toBe("duplicate"); // prettier-ignore
  });

  it("is a plain duplicate when the finish is equal or worse", () => {
    expect(rosterOutcome({ heldBefore: 1, editionBefore: "gold", edition: "gold" })).toBe("duplicate"); // prettier-ignore
    expect(rosterOutcome({ heldBefore: 1, editionBefore: "gold", edition: "bronze" })).toBe("duplicate"); // prettier-ignore
  });

  it("never upgrades on a finish the server has not decided", () => {
    // A rationed mint answers null. Calling that an upgrade over standard would
    // celebrate a finish nobody rolled.
    expect(rosterOutcome({ heldBefore: 1, editionBefore: "standard", edition: null })).toBe("duplicate"); // prettier-ignore
  });

  it("stays quiet when nobody can say what was held", () => {
    expect(rosterOutcome({ heldBefore: null, editionBefore: null, edition: "platinum" })).toBe("duplicate"); // prettier-ignore
  });
});

describe("secretOutcome", () => {
  it("is new on a first pull, whatever the level", () => {
    expect(secretOutcome({ duplicate: false, tierBefore: null, tier: "common" })).toBe("new");
  });

  it("is an upgrade when the level beats the copy owned", () => {
    expect(secretOutcome({ duplicate: true, tierBefore: "common", tier: "epic" })).toBe("upgrade");
  });

  it("is a plain duplicate at the same level or below", () => {
    expect(secretOutcome({ duplicate: true, tierBefore: "epic", tier: "epic" })).toBe("duplicate");
    expect(secretOutcome({ duplicate: true, tierBefore: "mythic", tier: "rare" })).toBe("duplicate"); // prettier-ignore
  });
});

describe("slotOutcome", () => {
  it("prefers the server's ledger over the phone's for a member", () => {
    const slot = roster({ heldBefore: 2, editionBefore: "gold", edition: "silver" });
    expect(slotOutcome(slot, { heldBefore: 0 })).toBe("duplicate");
  });

  it("falls back to the phone's snapshot for a guest", () => {
    const slot = roster({ heldBefore: null, editionBefore: null, edition: null });
    expect(slotOutcome(slot, { heldBefore: 0 })).toBe("new");
    expect(slotOutcome(slot, { heldBefore: 1 })).toBe("duplicate");
    expect(slotOutcome(slot)).toBe("duplicate");
  });

  it("reads a secret off its own flags", () => {
    expect(slotOutcome(secret())).toBe("new");
    expect(slotOutcome(secret({ duplicate: true, tierBefore: "common" }))).toBe("upgrade");
  });
});

describe("copiesAfter", () => {
  it("is one more than was held, from whichever side knows", () => {
    expect(copiesAfter(roster({ heldBefore: 2 }))).toBe(3);
    expect(copiesAfter(roster({ heldBefore: null }), { heldBefore: 0 })).toBe(1);
  });

  it("is null when nobody can say, so the ribbon stays off", () => {
    expect(copiesAfter(roster({ heldBefore: null }))).toBeNull();
  });

  it("leaves a secret's count to the server", () => {
    expect(copiesAfter(secret())).toBeNull();
  });
});

describe("peekMs", () => {
  it("holds every secret, new or not", () => {
    expect(peekMs(secret(), "new")).toBe(SECRET_PEEK_MS);
    expect(peekMs(secret({ duplicate: true }), "duplicate")).toBe(SECRET_PEEK_MS);
  });

  it("holds a roster card that is new or better than yours", () => {
    expect(peekMs(roster(), "new")).toBe(PEEK_MS);
    expect(peekMs(roster(), "upgrade")).toBe(PEEK_MS);
  });

  it("turns a plain duplicate straight over", () => {
    expect(peekMs(roster(), "duplicate")).toBeNull();
  });

  it("pins the beats the chime is tuned to", () => {
    expect(PEEK_MS).toBe(900);
    expect(SECRET_PEEK_MS).toBe(1600);
    expect(SECRET_RISER_AT_MS).toBeLessThan(SECRET_PEEK_MS);
  });
});

describe("celebrationFor", () => {
  it("fires the tier's own burst for a champion, whatever the collection held", () => {
    expect(celebrationFor({ slot: roster(), outcome: "duplicate", tier: "champion" })).toBe("tier");
    expect(celebrationFor({ slot: roster(), outcome: "new", tier: "podium" })).toBe("tier");
  });

  it("lets a good enough finish carry a base card", () => {
    expect(celebrationFor({ slot: roster({ edition: "gold" }), outcome: "duplicate", tier: "base" })).toBe("tier"); // prettier-ignore
  });

  it("stays silent on a finish the server has not decided", () => {
    expect(celebrationFor({ slot: roster({ edition: null }), outcome: "duplicate", tier: "base" })).toBe("quiet"); // prettier-ignore
  });

  it("lets the tier beat the upgrade when both apply", () => {
    expect(celebrationFor({ slot: roster({ edition: "bronze" }), outcome: "upgrade", tier: "champion" })).toBe("tier"); // prettier-ignore
  });

  it("celebrates an upgrade on an otherwise quiet card", () => {
    expect(celebrationFor({ slot: roster({ edition: "bronze" }), outcome: "upgrade", tier: "base" })).toBe("upgrade"); // prettier-ignore
  });

  it("is quiet on a plain duplicate, and on a new card that is nothing special", () => {
    expect(celebrationFor({ slot: roster(), outcome: "duplicate", tier: "base" })).toBe("quiet");
    // The NEW ribbon and the peek are the new card's moment; confetti stays for
    // the tier, the finish and the secret.
    expect(celebrationFor({ slot: roster(), outcome: "new", tier: "base" })).toBe("quiet");
  });

  it("frames a new secret, lifts an upgraded one, winks at a plain duplicate", () => {
    expect(celebrationFor({ slot: secret(), outcome: "new", tier: "base" })).toBe("secret");
    expect(celebrationFor({ slot: secret({ duplicate: true, tierBefore: "common" }), outcome: "upgrade", tier: "base" })).toBe("upgrade"); // prettier-ignore
    expect(celebrationFor({ slot: secret({ duplicate: true }), outcome: "duplicate", tier: "base" })).toBe("quiet"); // prettier-ignore
  });

  it("lets a legendary duplicate keep the level's own burst", () => {
    const slot = secret({ duplicate: true, tierBefore: "mythic", card: { ...secret().card, tier: "legendary" } }); // prettier-ignore
    expect(celebrationFor({ slot, outcome: "duplicate", tier: "base" })).toBe("tier");
  });
});

describe("upgradeLabel", () => {
  it("names the new rung, in its own metal", () => {
    expect(upgradeLabel(roster({ edition: "gold" }))).toMatchObject({ label: "Gold" });
    expect(upgradeLabel(secret({ card: { ...secret().card, tier: "epic" } }))).toMatchObject({ label: "Epic" }); // prettier-ignore
  });

  it("has nothing to name on a standard or unknown finish", () => {
    expect(upgradeLabel(roster({ edition: "standard" }))).toBeNull();
    expect(upgradeLabel(roster({ edition: null }))).toBeNull();
  });
});
