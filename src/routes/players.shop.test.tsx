// The shop's chrome: the header line and the unclaimed state. Every transaction
// lives in the two panels, which have their own tests, so both are stubbed out
// here along with every hook the page reads.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { Route } from "./players.shop";

const member = vi.hoisted(() => ({ current: null as { participantId: string } | null }));
const dustOn = vi.hoisted(() => ({ current: true }));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    Link: (props: { to: string; className?: string; children: ReactNode }) => (
      <a href={props.to} className={props.className}>
        {props.children}
      </a>
    ),
  };
});
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useServerFn: (fn: unknown) => fn,
}));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useQuery: () => ({ data: undefined }),
}));
vi.mock("@/hooks/use-event-bundle", () => ({
  useEventBundle: () => ({
    event: { id: "e1", dust_enabled: dustOn.current },
    bundle: null,
    loading: false,
    error: null,
    realtimeDegraded: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/lib/member-token", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMemberSession: () => member.current,
}));
vi.mock("@/hooks/use-daily-secret", () => ({ useSecretActor: () => null }));
vi.mock("@/hooks/use-dust", () => ({ useDustBalance: () => ({ data: undefined }) }));
vi.mock("@/hooks/use-photo-urls", () => ({
  useEventCardBack: () => ({ data: undefined }),
  useEventCardUrls: () => ({ data: undefined }),
}));
vi.mock("@/hooks/use-market", () => ({ useMarketListings: () => ({ data: undefined }) }));
vi.mock("@/hooks/use-trade-nudge", () => ({ useTradeNudge: vi.fn() }));
vi.mock("@/lib/member.functions", () => ({ getClaimRoster: "fn:roster" }));
vi.mock("@/components/dust-shop", () => ({ DustShopPanel: () => null }));
vi.mock("@/components/market-panel", () => ({ MarketPanel: () => null }));
vi.mock("@/components/dust-chip", () => ({ DustChip: () => null }));

const Page = Route.options.component as () => ReactNode;

beforeEach(() => {
  member.current = null;
  dustOn.current = true;
});

describe("the unclaimed shop", () => {
  it("does not count a balance nobody can have", () => {
    render(<Page />);
    expect(screen.getByText(/needs a claimed player/i)).toBeTruthy();
    expect(screen.queryByText("Counting…")).toBeNull();
  });

  it("still counts while a claimed player's balance is in the air", () => {
    member.current = { participantId: "p-alice" };
    render(<Page />);
    expect(screen.getByText("Counting…")).toBeTruthy();
  });

  it("still says dust is off for a guest, which is not about a balance", () => {
    dustOn.current = false;
    render(<Page />);
    expect(screen.getByText("The commissioner has not switched dust on yet.")).toBeTruthy();
  });

  it("reaches the Claim link with a pseudo-element hit area, not inline padding", () => {
    // jsdom has no layout; the class string is what can be pinned. min-h-11 here
    // would inflate the paragraph's line gap, which is why it is a ::before.
    render(<Page />);
    const link = screen.getByRole("link", { name: "Claim yours" });
    expect(link.className).toMatch(/\brelative\b/);
    expect(link.className).toMatch(/before:absolute/);
    expect(link.className).toMatch(/before:-inset-y-3.5/);
    expect(link.className).not.toMatch(/min-h-11/);
  });
});
