import { describe, expect, it } from "vitest";
import {
  isTradeOfferStatus,
  leagueDay,
  offerStatusLabel,
  tradeItemName,
  tradeItemsLabel,
  tradeSummaryLabel,
  tradeSwapPrompt,
  type TradeItemView,
  type TradeSummaryItem,
} from "./trades";

const rosterItem = (id = "ep-1"): TradeSummaryItem => ({ kind: "roster", eventParticipantId: id });
const secretItem = (name?: string): TradeSummaryItem =>
  name ? { kind: "secret", secretCardId: "sc-1", name } : { kind: "secret" };

describe("tradeSummaryLabel", () => {
  it("counts roster cards", () => {
    expect(tradeSummaryLabel([rosterItem()])).toBe("1 card");
    expect(tradeSummaryLabel([rosterItem("a"), rosterItem("b")])).toBe("2 cards");
  });

  it("names the secrets that carry a name", () => {
    expect(tradeSummaryLabel([secretItem("Tucker")])).toBe("Tucker");
    expect(tradeSummaryLabel([secretItem("Rocky"), secretItem("Dragon")])).toBe("Rocky + Dragon");
  });

  it("falls back to counting the ones that do not", () => {
    // Trades settled before the summary carried names, which stay in the feed.
    expect(tradeSummaryLabel([secretItem()])).toBe("a secret");
    expect(tradeSummaryLabel([secretItem(), secretItem()])).toBe("2 secrets");
    expect(tradeSummaryLabel([secretItem("Tucker"), secretItem()])).toBe("Tucker + a secret");
  });

  it("joins the two halves", () => {
    expect(tradeSummaryLabel([rosterItem("a"), rosterItem("b"), secretItem()])).toBe(
      "2 cards + a secret",
    );
    expect(tradeSummaryLabel([rosterItem("a"), secretItem("Zucchini")])).toBe("1 card + Zucchini");
  });

  it("has something to say about an empty side", () => {
    // Not reachable through the RPC, which refuses an empty side — but this
    // renders a jsonb column, and a blank string in the feed would read as a bug.
    expect(tradeSummaryLabel([])).toBe("nothing");
  });
});

describe("tradeItemsLabel", () => {
  it("says the same thing about a hydrated offer side", () => {
    const items: TradeItemView[] = [
      { kind: "roster", copyId: "c1", eventParticipantId: "ep-1", edition: "platinum" },
      {
        kind: "secret",
        pullId: "p1",
        name: "Gary the Grill",
        artUrl: null,
        collection: "pets",
        tier: "epic",
        lastCopy: true,
      },
    ];
    expect(tradeItemsLabel(items)).toBe("1 card + Gary the Grill");
  });
});

describe("offerStatusLabel", () => {
  it("labels every status the CHECK allows", () => {
    expect(offerStatusLabel("pending")).toBe("Pending");
    expect(offerStatusLabel("accepted")).toBe("Done");
    expect(offerStatusLabel("declined")).toBe("Declined");
    expect(offerStatusLabel("cancelled")).toBe("Pulled");
    expect(offerStatusLabel("voided")).toBe("Expired");
  });

  it("keeps declined and voided apart", () => {
    // Nobody said no to a voided offer — a staked card moved first. Collapsing
    // the two would tell somebody their friend turned them down when they did not.
    expect(offerStatusLabel("voided")).not.toBe(offerStatusLabel("declined"));
  });

  it("falls back rather than throwing on a status it does not know", () => {
    expect(offerStatusLabel("wat")).toBe("Unknown");
  });
});

describe("isTradeOfferStatus", () => {
  it("accepts the five the schema allows and nothing else", () => {
    for (const s of ["pending", "accepted", "declined", "cancelled", "voided"]) {
      expect(isTradeOfferStatus(s)).toBe(true);
    }
    expect(isTradeOfferStatus("expired")).toBe(false);
    expect(isTradeOfferStatus("")).toBe(false);
  });
});

describe("leagueDay", () => {
  it("renders the same YYYY-MM-DD text a Postgres date does", () => {
    expect(leagueDay(new Date("2026-08-17T16:00:00Z"))).toBe("2026-08-17");
  });

  it("uses the league's zone rather than the phone's", () => {
    // 03:00 UTC on the 18th is still the evening of the 17th in New York, which is
    // the whole reason the zone is pinned: somebody standing in the garden at
    // 11pm must not have their spares recomputed against tomorrow.
    expect(leagueDay(new Date("2026-08-18T03:00:00Z"))).toBe("2026-08-17");
  });

  it("rolls over at the league's midnight", () => {
    // 04:00 UTC is midnight EDT.
    expect(leagueDay(new Date("2026-08-18T04:00:00Z"))).toBe("2026-08-18");
  });

  it("tracks the standard-time offset too", () => {
    // January is EST (UTC-5), so the boundary moves an hour.
    expect(leagueDay(new Date("2026-01-18T04:30:00Z"))).toBe("2026-01-17");
    expect(leagueDay(new Date("2026-01-18T05:30:00Z"))).toBe("2026-01-18");
  });
});

// The confirm sheet on Accept, which is the one screen in the app that has to be
// exact about WHICH copy is leaving rather than brief about how many.
type RosterView = Extract<TradeItemView, { kind: "roster" }>;
type SecretView = Extract<TradeItemView, { kind: "secret" }>;

const rosterView = (over: Partial<RosterView> = {}): RosterView => ({
  kind: "roster",
  copyId: "c1",
  eventParticipantId: "ep-alice",
  edition: "standard",
  ...over,
});

const secretView = (over: Partial<SecretView> = {}): SecretView => ({
  kind: "secret",
  pullId: "p1",
  name: "Gary The Grill",
  artUrl: null,
  tier: "epic",
  collection: "pets",
  lastCopy: false,
  ...over,
});

const names: Record<string, string> = { "ep-alice": "Alice Ace", "ep-bob": "Bob Blitz" };
const nameOfCard = (id: string) => names[id] ?? "—";

describe("tradeItemName", () => {
  it("prints the finish on EVERY copy, standard included", () => {
    // editionLabel deliberately returns null for standard, because a chip
    // reading "Standard" on seven cards in ten is noise. Here it is the whole
    // point: it is what says which of your two Alices is the one going.
    expect(tradeItemName(rosterView(), nameOfCard)).toBe("Standard Alice Ace");
    expect(tradeItemName(rosterView({ edition: "gold" }), nameOfCard)).toBe("Gold Alice Ace");
  });

  it("names a secret by its level", () => {
    expect(tradeItemName(secretView(), nameOfCard)).toBe("Epic Gary The Grill");
  });

  it("degrades a stored finish nobody recognises to Standard", () => {
    // Editions arrive from Postgres as a bare string; toEdition is what stops a
    // corrupt one being read out loud in a confirmation.
    const corrupt = { ...rosterView(), edition: "chrome" } as unknown as TradeItemView;
    expect(tradeItemName(corrupt, nameOfCard)).toBe("Standard Alice Ace");
  });
});

describe("tradeSwapPrompt", () => {
  const nameOf = { theirName: "Bob Blitz", rosterName: nameOfCard };

  it("names both cards when a sentence can carry them", () => {
    expect(
      tradeSwapPrompt({
        give: [rosterView()],
        get: [rosterView({ eventParticipantId: "ep-bob", edition: "gold" })],
        ...nameOf,
      }),
    ).toBe("Swap your Standard Alice Ace for Bob Blitz's Gold Bob Blitz?");
  });

  it("falls back to counting on BOTH sides once either has two", () => {
    // Naming one side and counting the other reads as though the two were
    // different kinds of thing.
    expect(
      tradeSwapPrompt({
        give: [rosterView(), rosterView({ copyId: "c2" })],
        get: [secretView()],
        ...nameOf,
      }),
    ).toBe("Swap your 2 cards for Bob Blitz's Gary The Grill?");
  });

  it("asks a plain question when a side arrived empty", () => {
    // Not hypothetical: an item whose card has since been deleted is dropped on
    // the way out of getMyTradeOffers, so a live offer can have a bare side.
    expect(tradeSwapPrompt({ give: [], get: [rosterView()], ...nameOf })).toBe(
      "Take this offer from Bob Blitz?",
    );
    expect(tradeSwapPrompt({ give: [rosterView()], get: [], ...nameOf })).toBe(
      "Take this offer from Bob Blitz?",
    );
  });
});
