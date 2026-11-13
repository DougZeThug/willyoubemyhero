import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import {
  cardPullCountsKey,
  dustSparesKey,
  invalidateCardsMoved,
  invalidateSpares,
  myCardStatsKey,
  mySecretsKey,
  packStatusKey,
  tradeSparesKey,
} from "./query-keys";

const EVENT = "ev-1";
const ME = "p-me";
const ACTOR = "m:p-me";

function seeded(keys: readonly (readonly unknown[])[]) {
  const qc = new QueryClient();
  for (const k of keys) qc.setQueryData(k, 1);
  const stale = (k: readonly unknown[]) => qc.getQueryState(k)?.isInvalidated;
  return { qc, stale };
}

describe("invalidateSpares", () => {
  it("reaches both caches of the list, including a counterparty's under the viewer prefix", async () => {
    const theirs = tradeSparesKey(ME, "p-them");
    const { qc, stale } = seeded([theirs, dustSparesKey(ME), dustSparesKey("someone-else")]);
    await invalidateSpares(qc, ME);
    expect(stale(theirs)).toBe(true);
    expect(stale(dustSparesKey(ME))).toBe(true);
    expect(stale(dustSparesKey("someone-else"))).toBe(false);
  });
});

describe("invalidateCardsMoved", () => {
  it("marks everything a card leaving moves, and nothing about the pack", async () => {
    const moved = [
      tradeSparesKey(ME),
      dustSparesKey(ME),
      cardPullCountsKey(EVENT),
      myCardStatsKey(EVENT, ME),
      mySecretsKey(ACTOR),
    ];
    const { qc, stale } = seeded([...moved, packStatusKey(ACTOR)]);
    await invalidateCardsMoved(qc, { eventId: EVENT, participantId: ME, actor: ACTOR });
    for (const k of moved) expect(stale(k)).toBe(true);
    expect(stale(packStatusKey(ACTOR))).toBe(false);
  });

  it("does not match the secrets cache by a bare participant id", async () => {
    const { qc, stale } = seeded([mySecretsKey(ME)]);
    await invalidateCardsMoved(qc, { eventId: EVENT, participantId: ME, actor: ACTOR });
    expect(stale(mySecretsKey(ME))).toBe(false);
  });
});
