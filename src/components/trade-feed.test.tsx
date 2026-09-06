// The league's ledger, as its own tab.
//
// The interesting cases are the two that look identical from outside: a feed
// with nothing in it, and a feed that could not be read.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TradeFeedPanel } from "./trade-feed";
import type { TradeFeedEntry } from "@/lib/trades";

const NAMES: Record<string, string> = { "p-alice": "Alice Ace", "p-bob": "Bob Blitz" };
const nameOf = (id: string) => NAMES[id] ?? "Someone";

const entry = (over: Partial<TradeFeedEntry> = {}): TradeFeedEntry => ({
  id: "t1",
  proposerId: "p-alice",
  recipientId: "p-bob",
  proposerGave: [{ kind: "roster", eventParticipantId: "ep-alice" }],
  recipientGave: [{ kind: "secret", secretCardId: "sc-1", name: "Gary The Grill" }],
  executedAt: "2026-08-17T10:00:00Z",
  ...over,
});

describe("TradeFeedPanel", () => {
  it("names both sides and what moved between them", () => {
    render(<TradeFeedPanel entries={[entry()]} nameOf={nameOf} />);
    expect(screen.getByText("Alice Ace")).toBeInTheDocument();
    expect(screen.getByText("Bob Blitz")).toBeInTheDocument();
    expect(screen.getByText("1 card")).toBeInTheDocument();
    // The secret is named, which the summary has carried since the
    // trade-feed-secret-names migration.
    expect(screen.getByText("Gary The Grill")).toBeInTheDocument();
  });

  it("counts a secret the summary could not name", () => {
    // Trades settled before that widening carry `{kind:"secret"}` and nothing
    // else, and they stay in the feed forever.
    render(
      <TradeFeedPanel entries={[entry({ recipientGave: [{ kind: "secret" }] })]} nameOf={nameOf} />,
    );
    expect(screen.getByText("a secret")).toBeInTheDocument();
  });

  it("says what it is waiting for when nothing has traded", () => {
    // The section used to vanish entirely when empty (§10 problem 7). A tab
    // cannot vanish.
    render(<TradeFeedPanel entries={[]} nameOf={nameOf} />);
    expect(screen.getByText("Nothing has changed hands yet.")).toBeInTheDocument();
  });

  it("does not report a failed read as an empty ledger", () => {
    // Two states that look the same from outside and are not: "nothing has
    // changed hands yet" is a claim about the league, and a request that fell
    // over is no basis for making it.
    render(<TradeFeedPanel entries={[]} nameOf={nameOf} failed />);
    expect(screen.queryByText("Nothing has changed hands yet.")).not.toBeInTheDocument();
    expect(screen.getByText(/couldn't read the ledger/i)).toBeInTheDocument();
  });

  it("keeps showing what it has when a refresh fails underneath it", () => {
    // `failed` with rows in hand is a stale feed, not a broken one.
    render(<TradeFeedPanel entries={[entry()]} nameOf={nameOf} failed />);
    expect(screen.getByText("Alice Ace")).toBeInTheDocument();
    expect(screen.queryByText(/couldn't read the ledger/i)).not.toBeInTheDocument();
  });
});
