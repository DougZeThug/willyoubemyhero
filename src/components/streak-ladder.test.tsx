// The ladder, and what it has paid.
//
// Its absence was the biggest single gap in the streak feature (§11): a person
// learned a rung existed by landing on it, and nothing anywhere listed what the
// ones behind them had handed over. Both halves are asserted here — the shape of
// the ladder, and that a history row names its card.
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { StreakLadder } from "./streak-ladder";
import { STREAK_MILESTONES } from "@/lib/streaks";
import type { StreakHistoryEntry, StreakStatus } from "@/lib/streaks.functions";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...rest }: { children: React.ReactNode; to: string }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

function streak(over: Partial<StreakStatus> = {}): StreakStatus {
  const current = over.current ?? 8;
  return {
    kind: "member",
    current,
    startedOn: "2026-08-21",
    lastOpenedOn: "2026-08-29",
    openedToday: true,
    today: "2026-08-29",
    canClaim: true,
    milestones: STREAK_MILESTONES.map((m) => ({
      days: m.days,
      label: m.label,
      blurb: m.blurb,
      tierFloor: m.tierFloor,
      earned: current >= m.days,
      claimed: false,
    })),
    ...over,
  };
}

function entry(over: Partial<StreakHistoryEntry> = {}): StreakHistoryEntry {
  return {
    milestone: 3,
    label: "Three Days",
    claimedOn: "2026-08-23",
    streakStartedOn: "2026-08-21",
    card: {
      id: "c1",
      name: "Ghost of the Grill",
      flavour: null,
      foil: "prismatic",
      borderFx: "none",
      collection: null,
      artUrl: null,
      backUrl: null,
      tier: "epic",
    },
    ...over,
  };
}

describe("StreakLadder", () => {
  it("says nothing at all at zero", () => {
    // Same rule the flame and the pack summary keep: a ladder shown to somebody
    // who has never opened a pack is a list of things they have not done.
    render(<StreakLadder streak={streak({ current: 0 })} history={[]} />);
    expect(screen.queryByText("Three Days")).not.toBeInTheDocument();
    expect(screen.getByText(/open a pack to start a streak/i)).toBeInTheDocument();
  });

  it("draws every rung, whether or not it has been reached", () => {
    // The unreached ones are the information: four rungs behind you mean nothing
    // without the fifth in front.
    render(<StreakLadder streak={streak()} history={[]} />);
    for (const m of STREAK_MILESTONES) {
      expect(screen.getByText(m.label)).toBeInTheDocument();
    }
  });

  it("says which rungs are behind you in words, not only in colour", () => {
    render(<StreakLadder streak={streak({ current: 8 })} history={[]} />);
    const three = screen.getByText("Three Days").closest("li")!;
    const thirty = screen.getByText("Thirty Days").closest("li")!;
    expect(within(three).getByText(/waiting/i)).toBeInTheDocument();
    expect(within(thirty).getByText("30 days")).toBeInTheDocument();
  });

  it("marks a claimed rung as claimed rather than as merely reached", () => {
    const s = streak({ current: 8 });
    s.milestones = s.milestones.map((m) => (m.days === 3 ? { ...m, claimed: true } : m));
    render(<StreakLadder streak={s} history={[]} />);
    const three = screen.getByText("Three Days").closest("li")!;
    expect(within(three).getByText("Claimed")).toBeInTheDocument();
  });

  it("points a claimable rung at the vault instead of claiming it here", () => {
    // Deliberately read-only: claiming lives where the run was extended, and a
    // third button for a once-a-run action is a third way for it to half-happen.
    render(<StreakLadder streak={streak({ current: 8 })} history={[]} />);
    expect(screen.getByText(/three days is waiting/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /claim it on the vault/i })).toHaveAttribute(
      "href",
      "/players",
    );
  });

  it("says on the rung what a claimable one is waiting for", () => {
    // §23 F12. "Waiting" with the reason two sections up under ACCOUNT is not a
    // reason anybody reading a rung can see.
    render(<StreakLadder streak={streak({ current: 8, canClaim: false })} history={[]} />);
    const three = screen.getByText("Three Days").closest("li")!;
    expect(within(three).getByText(/an account is what claims it/i)).toBeInTheDocument();
  });

  it("says it once, on the rung that is actually next", () => {
    render(<StreakLadder streak={streak({ current: 8, canClaim: false })} history={[]} />);
    const week = screen.getByText("One Week").closest("li")!;
    expect(within(week).queryByText(/an account/i)).not.toBeInTheDocument();
    expect(screen.getAllByText(/an account is what claims it/i)).toHaveLength(1);
  });

  it("keeps the reason off a rung somebody can already claim", () => {
    render(<StreakLadder streak={streak({ current: 8 })} history={[]} />);
    expect(screen.queryByText(/an account/i)).not.toBeInTheDocument();
  });

  it("promises the next rung when nothing is waiting", () => {
    const s = streak({ current: 8 });
    s.milestones = s.milestones.map((m) => (m.earned ? { ...m, claimed: true } : m));
    render(<StreakLadder streak={s} history={[]} />);
    expect(screen.queryByText(/is waiting/i)).not.toBeInTheDocument();
    expect(screen.getByText(/day 14/i)).toBeInTheDocument();
  });

  it("names the card each claimed rung paid", () => {
    render(<StreakLadder streak={streak()} history={[entry()]} />);
    expect(screen.getByText("Ghost of the Grill")).toBeInTheDocument();
    expect(screen.getByText("Epic")).toBeInTheDocument();
    expect(screen.getByLabelText(/level 3 of 5/i)).toBeInTheDocument();
  });

  it("still lists a rung whose payout has gone, and one the ladder has dropped", () => {
    render(
      <StreakLadder
        streak={streak()}
        history={[entry({ milestone: 5, label: null, card: null, claimedOn: "2026-07-05" })]}
      />,
    );
    // The number is the one thing about a retired rung that was ever persisted.
    expect(screen.getByText("5 days")).toBeInTheDocument();
    expect(screen.getByText("5 Jul")).toBeInTheDocument();
  });

  it("shows nothing where there is no history rather than an empty heading", () => {
    render(<StreakLadder streak={streak()} history={[]} />);
    expect(screen.queryByText(/what you claimed/i)).not.toBeInTheDocument();
  });
});
