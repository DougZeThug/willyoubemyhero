// The card that answers "what should I do right now".
//
// Three pack states, an at-risk run and a claimable rung are the five branches
// this screen is FOR, and each of them is a thing the vault could not say at all
// before (§3, §11). The strings are checked byte-for-byte where the e2e suite
// matches them exactly.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TodayCard } from "./today-card";
import { STREAK_MILESTONES } from "@/lib/streaks";
import type { StreakStatus } from "@/lib/streaks.functions";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...rest }: { children: React.ReactNode; to: string }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

const NOW = Date.parse("2026-09-04T18:00:00Z");

function streak(over: Partial<StreakStatus> = {}): StreakStatus {
  const current = over.current ?? 4;
  return {
    kind: "member",
    current,
    startedOn: "2026-08-21",
    lastOpenedOn: "2026-08-24",
    openedToday: true,
    today: "2026-09-04",
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

function renderCard(over: Partial<React.ComponentProps<typeof TodayCard>> = {}) {
  return render(
    <TodayCard
      pack={{ state: "sealed", left: 0 }}
      packWaiting={false}
      nextPackAt={null}
      now={NOW}
      streak={null}
      {...over}
    />,
  );
}

describe("the pack, as a state", () => {
  it("offers today's pack when it is still sealed", () => {
    // Byte-identical to what this control has always said: the e2e suite matches
    // it exactly, and so does anyone who has learned the screen by its shape.
    renderCard();
    expect(screen.getByRole("link", { name: "Open today's pack" })).toHaveAttribute(
      "href",
      "/players/pack",
    );
  });

  it("says so in the label when a secret is waiting", () => {
    renderCard({ packWaiting: true });
    expect(
      screen.getByRole("link", { name: "Open today's pack — a secret is waiting" }),
    ).toBeInTheDocument();
  });

  it("asks somebody to finish a pack they left half open", () => {
    renderCard({ pack: { state: "torn", left: 2 } });
    expect(
      screen.getByRole("link", { name: "Finish your pack · 2 cards left" }),
    ).toBeInTheDocument();
  });

  it("counts one card in the singular", () => {
    renderCard({ pack: { state: "torn", left: 1 } });
    expect(screen.getByRole("link", { name: /1 card left$/ })).toBeInTheDocument();
  });

  it("counts down to the next one when today's is spent", () => {
    renderCard({ pack: { state: "done", left: 0 }, nextPackAt: "2026-09-04T23:50:00Z" });
    expect(screen.getByText("Next pack in 6h")).toBeInTheDocument();
  });

  it("draws no pack control at all once the pack is done", () => {
    // Deliberately not a link. The Pack tab is one tap away, so a second route
    // to the same screen here would be the nav drawn twice.
    renderCard({ pack: { state: "done", left: 0 } });
    expect(screen.queryByRole("link", { name: /pack/i })).not.toBeInTheDocument();
  });

  it("says the streak sentence beside the countdown, and only there", () => {
    // It is the reason to come back tomorrow, said on the day you already have.
    renderCard({ pack: { state: "done", left: 0 }, streak: streak() });
    expect(screen.getByText(/day 4 — streak alive/i)).toBeInTheDocument();
  });

  it("promises nothing while it is still reading the pack row", () => {
    // IndexedDB answers a tick after mount and never during SSR. Painting "Open
    // today's pack" over a pack somebody is halfway through, then swapping the
    // label under their thumb, is the failure this state exists to avoid.
    renderCard({ pack: { state: "loading", left: 0 } });
    expect(screen.queryByRole("link", { name: /pack/i })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/checking today's pack/i);
  });

  it("shows a guest the same three states", () => {
    // A guest has no actor, so no secret cue and no streak — but the pack is
    // local, and it is theirs.
    renderCard({ pack: { state: "torn", left: 3 }, streak: null, packWaiting: false });
    expect(screen.getByRole("link", { name: /finish your pack/i })).toBeInTheDocument();
    expect(screen.queryByTestId("streak-flame")).not.toBeInTheDocument();
  });
});

describe("the streak strip", () => {
  it("stays off at zero", () => {
    // A flame at zero is a reward for having done nothing.
    renderCard({ streak: streak({ current: 0 }) });
    expect(screen.queryByTestId("streak-flame")).not.toBeInTheDocument();
  });

  it("draws the whole ladder once a run exists", () => {
    // Its absence was the biggest gap in the feature: people learned a rung
    // existed by landing on it.
    renderCard({ streak: streak({ current: 4 }) });
    expect(screen.getByTestId("streak-flame")).toBeInTheDocument();
    expect(screen.getByText("Day 4")).toBeInTheDocument();
    for (const m of STREAK_MILESTONES) {
      expect(screen.getByText(String(m.days))).toBeInTheDocument();
    }
  });

  it("marks the rungs behind you and the ones still ahead", () => {
    renderCard({ streak: streak({ current: 7 }) });
    expect(screen.getByText("3").textContent).toMatch(/reached/);
    expect(screen.getByText("7").textContent).toMatch(/reached/);
    expect(screen.getByText("14").textContent).toMatch(/still to go/);
  });

  it("names what the next rung pays", () => {
    // The only place the ladder is visible BEFORE you are standing on it.
    renderCard({ streak: streak({ current: 4 }) });
    expect(screen.getByText("Day 7 pays Rare or better.")).toBeInTheDocument();
  });

  it("tells a live run it is at risk", () => {
    // `walkStreak` counts a run that ended yesterday as alive, and that
    // asymmetry is the whole feature: it is one missed evening from gone.
    renderCard({ streak: streak({ current: 4, openedToday: false }) });
    expect(screen.getByText("Keep it alive")).toBeInTheDocument();
  });

  it("holds the strip's space while an answer is still coming", () => {
    // Reserved rather than absent, or the shelves step down by 44px the moment
    // the query lands — under a thumb already reaching for a card.
    renderCard({ streak: null, streakPending: true });
    expect(screen.getByTestId("streak-slot")).toBeEmptyDOMElement();
  });

  it("gives the space back once the answer is known to be nothing", () => {
    // Reserving it forever would spend 44px of a screen the audit already
    // faults for its height on somebody who has never opened a pack.
    renderCard({ streak: streak({ current: 0 }), streakPending: false });
    expect(screen.queryByTestId("streak-slot")).not.toBeInTheDocument();
  });
});

describe("claiming a rung from home", () => {
  const claimable = {
    days: 3,
    label: "Three Days",
    blurb: "A bonus secret, on the house.",
    tierFloor: null,
    earned: true,
    claimed: false,
  };

  it("offers the claim where the streak is, not two taps away on the pack", () => {
    renderCard({ streak: streak(), claimable, canClaim: true });
    expect(screen.getByRole("button", { name: "Claim Three Days" })).toBeInTheDocument();
  });

  it("hands the rung back when it is pressed", async () => {
    const onClaim = vi.fn();
    renderCard({ streak: streak(), claimable, canClaim: true, onClaim });
    await userEvent.click(screen.getByRole("button", { name: "Claim Three Days" }));
    expect(onClaim).toHaveBeenCalledOnce();
  });

  it("says it is working rather than letting a second tap through", () => {
    renderCard({ streak: streak(), claimable, canClaim: true, claiming: true });
    expect(screen.getByRole("button", { name: "Opening…" })).toBeDisabled();
  });

  it("refuses inline and never as a toast", () => {
    // A toast announces the reward to whoever is glancing at the phone over
    // your shoulder.
    renderCard({
      streak: streak(),
      claimable,
      canClaim: true,
      claimError: "Already collected — it's in your vault.",
    });
    expect(screen.getByText(/already collected/i)).toBeInTheDocument();
  });

  it("will not spend a claim with no connection behind it", () => {
    renderCard({ streak: streak(), claimable, canClaim: true, offline: true });
    expect(screen.getByRole("button", { name: /claim three days/i })).toBeDisabled();
  });

  it("asks a guest for an account, and says which reward is waiting", () => {
    // The gate lands at the payoff, which is the best moment to ask.
    renderCard({ streak: streak({ canClaim: false }), claimable, canClaim: false });
    const link = screen.getByRole("link", { name: "Sign in to claim" });
    expect(link).toHaveAttribute("href", "/auth");
    expect(screen.getByText(/three days is waiting/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /claim/i })).not.toBeInTheDocument();
  });

  it("goes back to the next-rung promise when there is nothing to claim", () => {
    renderCard({ streak: streak({ current: 4 }), claimable: null });
    expect(screen.queryByRole("button", { name: /claim/i })).not.toBeInTheDocument();
    expect(screen.getByText(/day 7 pays/i)).toBeInTheDocument();
  });
});

describe("the offer pill", () => {
  it("stays off when nothing is waiting", () => {
    // The Trade tab is always one tap away, so a permanent pill here would be
    // the nav drawn twice.
    renderCard({ tradeUnread: 0 });
    expect(screen.queryByText(/offer waiting/i)).not.toBeInTheDocument();
  });

  it("appears the moment an offer lands", () => {
    renderCard({ tradeUnread: 2 });
    expect(screen.getByRole("link", { name: /offer waiting/i })).toHaveAttribute(
      "href",
      "/players/trade",
    );
  });
});
