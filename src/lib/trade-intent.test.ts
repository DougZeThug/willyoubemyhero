import { beforeEach, describe, expect, it } from "vitest";
import { clearTradeIntent, setTradeIntent, takeTradeIntent } from "./trade-intent";

beforeEach(() => clearTradeIntent());

describe("the trade intent", () => {
  it("hands the card over once, and once only", () => {
    setTradeIntent({ side: "give", kind: "roster", eventParticipantId: "ep-alice" });
    expect(takeTradeIntent()).toEqual({
      side: "give",
      kind: "roster",
      eventParticipantId: "ep-alice",
    });
    // The whole point: a second visit to the Trading Post is a blank form, not a
    // card staging itself again over somebody's half-built offer.
    expect(takeTradeIntent()).toBeNull();
  });

  it("is empty until something sets one", () => {
    expect(takeTradeIntent()).toBeNull();
  });

  it("keeps only the last one — a second tap replaces the first", () => {
    setTradeIntent({ side: "give", kind: "roster", eventParticipantId: "ep-alice" });
    setTradeIntent({ side: "want", kind: "roster", eventParticipantId: "ep-bob" });
    expect(takeTradeIntent()).toEqual({
      side: "want",
      kind: "roster",
      eventParticipantId: "ep-bob",
    });
  });

  it("carries a secret by name, because that is the only handle both ends share", () => {
    // getTradeSpares answers with { pullId, name, artUrl, tier } and no card id,
    // so a secret card id here would be a key nothing on the other side can turn.
    setTradeIntent({ side: "give", kind: "secret", name: "Gary The Grill" });
    expect(takeTradeIntent()).toEqual({ side: "give", kind: "secret", name: "Gary The Grill" });
  });
});
