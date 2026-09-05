// The offer being built, before anybody has rendered it.
//
// Most of this used to live inside players.trade.tsx as closures over component
// state, which is why none of it had a test — and `spareForIntent`'s rule is the
// one worth having: staging the WRONG copy of a card into a real trade is not a
// mistake anybody would spot until their mythic was gone.
import { describe, expect, it } from "vitest";
import {
  MAX_PER_SIDE,
  blockedItems,
  blockedKey,
  hasLastCopy,
  pickerItems,
  spareForIntent,
  stagedRoster,
  stagedSecret,
  stepBlocker,
  toggleStaged,
} from "./trade-staging";
import type { RosterSpare, SecretSpare, TradeSpares } from "./trades";

const roster = (over: Partial<RosterSpare> = {}): RosterSpare => ({
  copyId: "copy-1",
  eventParticipantId: "ep-1",
  edition: "standard",
  viewerOwns: true,
  assertedBy: "server",
  ...over,
});

const secret = (over: Partial<SecretSpare> = {}): SecretSpare => ({
  pullId: "pull-1",
  name: "Gary The Grill",
  artUrl: null,
  tier: "common",
  lastCopy: false,
  viewerOwns: true,
  ...over,
});

const spares = (over: Partial<TradeSpares> = {}): TradeSpares => ({
  participantId: "p-1",
  roster: [],
  secrets: [],
  blocked: [],
  ownedRoster: [],
  ...over,
});

/** Alice leads Bob, so the ordering below has something to say. */
const rank = (id: string) => (id === "ep-alice" ? 0 : 5);

describe("the payloads a staged card carries", () => {
  // These two shapes ARE the create_trade_offer request body. The RPC validates
  // them with its own zod schema, so a silent rename here would not be caught by
  // typecheck on either side — only by the offer being refused at the door.
  it("stakes a roster card by its copy", () => {
    expect(stagedRoster(roster({ copyId: "c9" }))).toMatchObject({
      key: "c:c9",
      payload: { kind: "roster", cardCopyId: "c9" },
    });
  });

  it("stakes a secret by its ledger row, never by its card", () => {
    expect(stagedSecret(secret({ pullId: "p9" }))).toMatchObject({
      key: "s:p9",
      payload: { kind: "secret", secretPullId: "p9" },
    });
  });

  it("carries the finish and the last-copy marker through to the tile", () => {
    expect(stagedRoster(roster({ edition: "gold" })).item).toMatchObject({ edition: "gold" });
    expect(stagedSecret(secret({ lastCopy: true })).item).toMatchObject({ lastCopy: true });
  });
});

describe("pickerItems", () => {
  it("puts secrets first, rarest copy leading", () => {
    const items = pickerItems(
      spares({
        secrets: [
          secret({ pullId: "a", tier: "common", name: "Common" }),
          secret({ pullId: "b", tier: "mythic", name: "Mythic" }),
        ],
        roster: [roster()],
      }),
      rank,
    );
    expect(items.map((s) => s.key)).toEqual(["s:b", "s:a", "c:copy-1"]);
  });

  it("orders roster copies by earned tier, then card, then finish", () => {
    const items = pickerItems(
      spares({
        roster: [
          roster({ copyId: "bob", eventParticipantId: "ep-bob" }),
          roster({ copyId: "alice-std", eventParticipantId: "ep-alice", edition: "standard" }),
          roster({ copyId: "alice-gold", eventParticipantId: "ep-alice", edition: "gold" }),
        ],
      }),
      rank,
    );
    // The champion's card leads, its two copies stay together, and the metal
    // comes before the plain one.
    expect(items.map((s) => s.key)).toEqual(["c:alice-gold", "c:alice-std", "c:bob"]);
  });

  it("survives a spares response that carries neither list", () => {
    // Four e2e stubs omit `blocked` and `ownedRoster` entirely, and an older
    // server could omit more. An empty picker beats a thrown render.
    expect(pickerItems(undefined, rank)).toEqual([]);
    expect(blockedItems(undefined)).toEqual([]);
  });
});

describe("blockedKey", () => {
  it("keys a blocked tile apart from a stakeable one", () => {
    // Both lists can hold the same card, and two React children with one key is
    // a silently dropped tile.
    const item = stagedRoster(roster({ copyId: "c1" })).item;
    expect(blockedKey({ item, reason: "only-copy" })).toBe("bc:c1");
    expect(blockedKey({ item: stagedSecret(secret({ pullId: "p1" })).item, reason: "todays-pull" })).toBe("bs:p1"); // prettier-ignore
  });
});

describe("toggleStaged", () => {
  const a = stagedRoster(roster({ copyId: "a" }));
  const b = stagedRoster(roster({ copyId: "b" }));

  it("adds and takes back off by key", () => {
    expect(toggleStaged([], a).next.map((s) => s.key)).toEqual(["c:a"]);
    expect(toggleStaged([a, b], a).next.map((s) => s.key)).toEqual(["c:b"]);
  });

  it("refuses a fifth card a side, and says that is what happened", () => {
    const full = ["1", "2", "3", "4"].map((id) => stagedRoster(roster({ copyId: id })));
    expect(full).toHaveLength(MAX_PER_SIDE);
    const { next, capped } = toggleStaged(full, a);
    expect(capped).toBe(true);
    expect(next.map((s) => s.key)).toEqual(full.map((s) => s.key));
  });

  it("still lets a full side put one back, so a swap is possible at the cap", () => {
    const full = ["1", "2", "3", "4"].map((id) => stagedRoster(roster({ copyId: id })));
    const { next, capped } = toggleStaged(full, full[0]);
    expect(capped).toBe(false);
    expect(next).toHaveLength(3);
  });
});

describe("spareForIntent", () => {
  it("hands over the PLAINEST copy of a card, not the best one", () => {
    // You asked for the card, not for the metal. The picker is one tap away if
    // the platinum was really the point.
    const staged = spareForIntent(
      { side: "give", kind: "roster", eventParticipantId: "ep-alice" },
      spares({
        roster: [
          roster({ copyId: "plat", eventParticipantId: "ep-alice", edition: "platinum" }),
          roster({ copyId: "std", eventParticipantId: "ep-alice", edition: "standard" }),
        ],
      }),
    );
    expect(staged?.key).toBe("c:std");
  });

  it("does the same on the secret side, where it used to be a coin toss", () => {
    // getTradeSpares answers one row per pull with no promised order, so an
    // unsorted `find` staged the mythic half the time.
    const staged = spareForIntent(
      { side: "give", kind: "secret", secretCardId: "sc-1", name: "Gary The Grill" },
      spares({
        secrets: [
          secret({ pullId: "myth", cardId: "sc-1", tier: "mythic" }),
          secret({ pullId: "common", cardId: "sc-1", tier: "common" }),
        ],
      }),
    );
    expect(staged?.key).toBe("s:common");
  });

  it("matches a secret by id, because two cards may share a name", () => {
    const staged = spareForIntent(
      { side: "give", kind: "secret", secretCardId: "sc-2", name: "Gary The Grill" },
      spares({
        secrets: [
          secret({ pullId: "one", cardId: "sc-1", name: "Gary The Grill" }),
          secret({ pullId: "two", cardId: "sc-2", name: "Gary The Grill" }),
        ],
      }),
    );
    expect(staged?.key).toBe("s:two");
  });

  it("falls back to the name for a response older than the id field", () => {
    const staged = spareForIntent(
      { side: "give", kind: "secret", secretCardId: "sc-1", name: "Gary The Grill" },
      spares({ secrets: [secret({ pullId: "one", name: "Gary The Grill" })] }),
    );
    expect(staged?.key).toBe("s:one");
  });

  it("answers nothing when there is no spare of it, and when nothing has landed", () => {
    expect(
      spareForIntent({ side: "want", kind: "roster", eventParticipantId: "ep-nobody" }, spares()),
    ).toBeNull();
    expect(
      spareForIntent({ side: "want", kind: "roster", eventParticipantId: "ep-1" }, undefined),
    ).toBeNull();
  });
});

describe("hasLastCopy", () => {
  it("is the secrets question — a roster copy can never be somebody's only one", () => {
    expect(hasLastCopy([stagedRoster(roster())])).toBe(false);
    expect(hasLastCopy([stagedSecret(secret({ lastCopy: false }))])).toBe(false);
    expect(hasLastCopy([stagedRoster(roster()), stagedSecret(secret({ lastCopy: true }))])).toBe(
      true,
    );
  });
});

describe("stepBlocker", () => {
  const none = { theirId: null, give: [], want: [] };
  const card = stagedRoster(roster());

  it("wants somebody to trade with first", () => {
    expect(stepBlocker("who", none)).toBe("Pick who to trade with.");
    expect(stepBlocker("who", { ...none, theirId: "p-2" })).toBeNull();
  });

  it("names the empty side rather than saying the offer is incomplete", () => {
    expect(stepBlocker("trays", { theirId: "p-2", give: [], want: [card] })).toMatch(/your cards/);
    expect(stepBlocker("trays", { theirId: "p-2", give: [card], want: [] })).toMatch(/theirs/);
    expect(stepBlocker("trays", { theirId: "p-2", give: [card], want: [card] })).toBeNull();
  });

  it("blocks nothing on review — by then everything it could ask for is there", () => {
    expect(stepBlocker("review", none)).toBeNull();
  });
});
