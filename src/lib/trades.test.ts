import { describe, expect, it } from "vitest";
import {
  isTradeOfferStatus,
  leagueDay,
  offerStatusLabel,
  tradeItemsLabel,
  tradeSummaryLabel,
  type TradeItemView,
  type TradeSummaryItem,
} from "./trades";

const rosterItem = (id = "ep-1"): TradeSummaryItem => ({ kind: "roster", eventParticipantId: id });
const secretItem = (): TradeSummaryItem => ({ kind: "secret" });

describe("tradeSummaryLabel", () => {
  it("counts roster cards", () => {
    expect(tradeSummaryLabel([rosterItem()])).toBe("1 card");
    expect(tradeSummaryLabel([rosterItem("a"), rosterItem("b")])).toBe("2 cards");
  });

  it("names secrets without naming them", () => {
    // The whole reason this reads off `kind`: the public summary carries nothing
    // else about a secret, so there is nothing here that could accidentally leak.
    expect(tradeSummaryLabel([secretItem()])).toBe("a secret");
    expect(tradeSummaryLabel([secretItem(), secretItem()])).toBe("2 secrets");
  });

  it("joins the two halves", () => {
    expect(tradeSummaryLabel([rosterItem("a"), rosterItem("b"), secretItem()])).toBe(
      "2 cards + a secret",
    );
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
        tier: "epic",
        lastCopy: true,
      },
    ];
    expect(tradeItemsLabel(items)).toBe("1 card + a secret");
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
