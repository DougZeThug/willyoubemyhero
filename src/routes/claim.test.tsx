// The one screen where a paper code is typed, and the only way onto the roster.
//
// What is pinned here is the picker's three answers, because the list IS the
// interaction: the two other screens that read `claim-roster` only want a name
// out of it and fall back to "Someone" when it misses, so a failed read has no
// consequence there and every consequence here. It used to have one answer —
// "loading", then a grid — so a read that failed and a league with nobody on it
// drew the same blank space over the same dead Claim button.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import ClaimPage from "./claim";

const useQuery = vi.fn();
const useMemberSession = vi.fn();

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    Link: (props: { to: string; children: ReactNode }) => <a href={props.to}>{props.children}</a>,
    useNavigate: () => vi.fn(),
  };
});

vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});

vi.mock("@tanstack/react-query", () => ({ useQuery: (...a: unknown[]) => useQuery(...a) }));

vi.mock("@/hooks/use-account", () => ({
  useAuthUser: () => ({ user: null, loading: false }),
  signOutAccount: vi.fn(),
}));

vi.mock("@/lib/member-token", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useMemberSession: () => useMemberSession() };
});

const ATHLETE = {
  id: "p-doug",
  name: "Doug",
  nickname: null,
  hasCode: true,
  claimed: false,
  isCollector: false,
  reachable: false,
};
const COLLECTOR = { ...ATHLETE, id: "p-jane", name: "Jane", isCollector: true };

/** The shape `useQuery` hands back, with only the four fields the page reads. */
function rosterState(over: Partial<ReturnType<typeof useQuery>> = {}) {
  return { data: [], isLoading: false, isError: false, error: null, refetch: vi.fn(), ...over };
}

beforeEach(() => {
  window.localStorage.clear();
  useMemberSession.mockReturnValue(null);
  useQuery.mockReturnValue(rosterState({ data: [ATHLETE] }));
});

describe("the name picker", () => {
  it("offers everyone with a paper code, and nobody without one", () => {
    useQuery.mockReturnValue(rosterState({ data: [ATHLETE, COLLECTOR] }));
    render(<ClaimPage />);
    expect(screen.getByRole("button", { name: "Doug" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Jane" })).not.toBeInTheDocument();
  });

  it("says the list is still coming", () => {
    useQuery.mockReturnValue(rosterState({ isLoading: true }));
    render(<ClaimPage />);
    expect(screen.getByText(/loading roster/i)).toBeInTheDocument();
  });

  it("says the read failed, rather than drawing a league with nobody in it", async () => {
    const refetch = vi.fn();
    useQuery.mockReturnValue(
      rosterState({ isError: true, error: new Error("Failed to fetch"), refetch }),
    );
    render(<ClaimPage />);

    expect(screen.getByText(/can't reach the combine/i)).toBeInTheDocument();
    expect(screen.getByText("Failed to fetch")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it("keeps the empty roster distinguishable from the failed one", () => {
    render(<ClaimPage />);
    expect(screen.queryByText(/nobody on the roster/i)).not.toBeInTheDocument();

    useQuery.mockReturnValue(rosterState({ data: [COLLECTOR] }));
    render(<ClaimPage />);
    // Collectors only: a roster that arrived, with nothing on it to claim.
    expect(screen.getByText(/nobody on the roster/i)).toBeInTheDocument();
    expect(screen.queryByText(/can't reach the combine/i)).not.toBeInTheDocument();
  });
});
