// The top of the screen the app opens to, once everything that answers "what
// should I do right now" has moved next door to TodayCard. What is left is
// identity — the name of the screen, the dust, and the three things that only
// matter to somebody who has not finished signing in — and each branch here is a
// thing that has already been got wrong once somewhere.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { VaultHero } from "./vault-hero";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...rest }: { children: React.ReactNode; to: string }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

function renderHero(over: Partial<React.ComponentProps<typeof VaultHero>> = {}) {
  return render(
    <VaultHero dustOn={false} dustBalance={undefined} isMember wasMember={false} {...over} />,
  );
}

describe("VaultHero", () => {
  it("keeps the heading the rest of the app navigates by", () => {
    renderHero();
    expect(screen.getByRole("heading", { name: /the vault/i })).toBeInTheDocument();
  });

  it("keeps the dust chip off until the commissioner switches the economy on", () => {
    renderHero({ dustOn: false, dustBalance: 140 });
    expect(screen.queryByText(/dust/i)).not.toBeInTheDocument();
  });

  it("shows the balance once the economy is live", () => {
    renderHero({ dustOn: true, dustBalance: 140 });
    expect(screen.getByText(/140 dust/i)).toBeInTheDocument();
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

  it("says nothing about linking when the account is fine", () => {
    renderHero({ syncError: null });
    expect(screen.queryByText(/could not finish linking/i)).not.toBeInTheDocument();
  });

  it("says why the shelf is empty when linking failed", () => {
    // The message used to live only on /auth, so a deep link into the vault
    // showed an empty shelf and no reason for it.
    renderHero({
      syncError: "Your cards are safe, but this phone could not finish linking them.",
    });
    expect(screen.getByText(/could not finish linking them/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /try again/i })).toHaveAttribute("href", "/auth");
  });

  it("counts nothing at all any more", () => {
    // "N of M cards printed" was an admin concept on a player-facing screen —
    // cards that have art, reading as a collector's number — and the packs and
    // secrets counters went with it to the one summary line under TodayCard.
    // The data is still fetched; this header is not where it belongs (§13).
    renderHero();
    expect(screen.queryByText(/printed/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/packs? opened/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/secrets? pulled/i)).not.toBeInTheDocument();
  });

  it("no longer draws the pack button or the flame", () => {
    // Two copies of either would be the trap streak-flame.tsx's own test id
    // warns about, and the e2e suite reaches the pack cue by role on this page.
    renderHero();
    expect(screen.queryByTestId("streak-flame")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /open today's pack/i })).not.toBeInTheDocument();
  });
});
