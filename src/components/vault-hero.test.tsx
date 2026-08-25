// The header of the screen the app opens to. Everything on it is either a cue
// the daily loop turns on or a counter that must not say more than it knows, so
// each branch here is a thing that has already been got wrong once somewhere.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { VaultHero } from "./vault-hero";
import type { Streak } from "@/lib/streaks";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...rest }: { children: React.ReactNode; to: string }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

function streak(over: Partial<Streak> = {}): Streak {
  return { current: 4, startedOn: "2026-08-21", lastOpenedOn: "2026-08-24", openedToday: true, ...over }; // prettier-ignore
}

function renderHero(over: Partial<React.ComponentProps<typeof VaultHero>> = {}) {
  return render(
    <VaultHero
      printed={13}
      rosterSize={13}
      ready
      collectedCount={5}
      packsOpened={2}
      secretsPulled={0}
      dustOn={false}
      dustBalance={undefined}
      onOpenShop={() => {}}
      isMember
      wasMember={false}
      streak={null}
      packWaiting={false}
      tradeUnread={0}
      {...over}
    />,
  );
}

describe("VaultHero", () => {
  it("keeps the heading the rest of the app navigates by", () => {
    renderHero();
    expect(screen.getByRole("heading", { name: /the vault/i })).toBeInTheDocument();
  });

  it("names the pack plainly when there is nothing extra waiting", () => {
    // Byte-identical to what it has always said: the e2e suite matches this
    // exactly, and so does anyone who has learned the screen by its shape.
    renderHero();
    expect(screen.getByRole("link", { name: "Open today's pack" })).toBeInTheDocument();
  });

  it("says so in the label when a secret is waiting", () => {
    renderHero({ packWaiting: true });
    expect(
      screen.getByRole("link", { name: "Open today's pack — a secret is waiting" }),
    ).toBeInTheDocument();
  });

  it("shows no flame before anybody has asked", () => {
    renderHero({ streak: null });
    expect(screen.queryByTestId("streak-flame")).not.toBeInTheDocument();
  });

  it("shows no flame at zero", () => {
    // A flame at zero is a reward for having done nothing.
    renderHero({ streak: streak({ current: 0 }) });
    expect(screen.queryByTestId("streak-flame")).not.toBeInTheDocument();
  });

  it("shows the flame and the nudge once a run exists", () => {
    renderHero({ streak: streak() });
    expect(screen.getByTestId("streak-flame")).toBeInTheDocument();
    expect(screen.getByText(/day 4 — streak alive/i)).toBeInTheDocument();
  });

  it("tells a live streak it is at risk", () => {
    renderHero({ streak: streak({ openedToday: false }) });
    expect(screen.getByText(/open today's pack to keep it alive/i)).toBeInTheDocument();
  });

  it("keeps the dust chip off until the commissioner switches the economy on", () => {
    renderHero({ dustOn: false, dustBalance: 140 });
    expect(screen.queryByText(/dust/i)).not.toBeInTheDocument();
  });

  it("shows the balance once the economy is live", () => {
    renderHero({ dustOn: true, dustBalance: 140 });
    expect(screen.getByText(/140 dust/i)).toBeInTheDocument();
  });

  it("draws no trade shortcut when nothing is waiting", () => {
    // The tab is always one tap away, so a permanent pill here is the nav drawn
    // twice — and, until this was removed, a second link named "Trade".
    renderHero({ tradeUnread: 0 });
    expect(screen.queryByText(/offer waiting/i)).not.toBeInTheDocument();
  });

  it("draws one the moment an offer lands", () => {
    renderHero({ tradeUnread: 2 });
    expect(screen.getByText(/offer waiting/i)).toBeInTheDocument();
  });

  it("asks a guest to claim", () => {
    renderHero({ isMember: false });
    expect(screen.getByText(/claim your player/i)).toBeInTheDocument();
  });

  it("leaves a member alone", () => {
    renderHero({ isMember: true });
    expect(screen.queryByText(/claim your player/i)).not.toBeInTheDocument();
  });

  it("tells a member on a new phone where their collection went", () => {
    renderHero({ isMember: false, wasMember: true });
    expect(screen.getByText(/on your name, not on this phone/i)).toBeInTheDocument();
  });

  it("says nothing about secrets to somebody who has pulled none", () => {
    // "0 secrets pulled" would announce that a set exists at all, which is the
    // one thing this screen withholds.
    renderHero({ secretsPulled: 0 });
    expect(screen.queryByText(/secrets? pulled/i)).not.toBeInTheDocument();
  });

  it("counts the ones somebody does hold", () => {
    renderHero({ secretsPulled: 3 });
    expect(screen.getByText(/3 secrets pulled/i)).toBeInTheDocument();
  });

  it("holds the collected count back until the collection has reconciled", () => {
    renderHero({ ready: false, collectedCount: 13, packsOpened: 4 });
    expect(screen.queryByText(/collected/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/packs opened/i)).not.toBeInTheDocument();
  });
});
