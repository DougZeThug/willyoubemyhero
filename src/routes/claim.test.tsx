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

// Spied on rather than stubbed out: the claim ordering test below is entirely
// about WHEN this lands relative to the trophy carry, so the real one would work
// as well — this just makes the moment observable.
const setMemberToken = vi.hoisted(() => vi.fn());
vi.mock("@/lib/member-token", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useMemberSession: () => useMemberSession(),
    setMemberToken: (...args: unknown[]) => setMemberToken(...args),
  };
});

const claimPlayer = vi.hoisted(() => vi.fn());
vi.mock("@/lib/member.functions", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  claimPlayer: (...args: unknown[]) => claimPlayer(...args),
}));

const carryTrophySeen = vi.hoisted(() => vi.fn());
vi.mock("@/lib/trophy-seen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/trophy-seen")>()),
  carryTrophySeen: (...args: unknown[]) => carryTrophySeen(...args),
}));

const carryPackToIdentity = vi.hoisted(() => vi.fn());
vi.mock("@/lib/card-collection", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/card-collection")>()),
  carryPackToIdentity: (...args: unknown[]) => carryPackToIdentity(...args),
}));

const adoptLocalCollection = vi.hoisted(() => vi.fn());
vi.mock("@/lib/adopt-collection", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/adopt-collection")>()),
  adoptLocalCollection: (...args: unknown[]) => adoptLocalCollection(...args),
  snapshotLocalCollection: async () => ({}),
}));

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

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

/** The shape `useQuery` hands back, with only the parts the page reads. */
type RosterState = {
  data: (typeof ATHLETE)[] | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
};

function rosterState(over: Partial<RosterState> = {}): RosterState {
  return { data: [], isLoading: false, isError: false, error: null, refetch: vi.fn(), ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  window.localStorage.setItem("wwbh:device-id", "dev-1");
  useMemberSession.mockReturnValue(null);
  useQuery.mockReturnValue(rosterState({ data: [ATHLETE] }));
  claimPlayer.mockResolvedValue({ ok: true, token: "m.tok", name: "Doug" });
  adoptLocalCollection.mockResolvedValue(1);
  carryPackToIdentity.mockResolvedValue(undefined);
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
      // `data: undefined` is a read that never landed — nothing cached to fall
      // back on, which is the state a first visit fails into.
      rosterState({ data: undefined, isError: true, error: new Error("Failed to fetch"), refetch }),
    );
    render(<ClaimPage />);

    expect(screen.getByText(/can't reach the combine/i)).toBeInTheDocument();
    expect(screen.getByText("Failed to fetch")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it("keeps the names it has when a refetch fails, rather than dropping the picker", () => {
    // The shape every spectator screen uses — `error && !bundle`. A roster this
    // short does not go stale in a way that stops a code working, so a wobble on
    // a background refetch must not take a usable picker off the screen.
    useQuery.mockReturnValue(
      rosterState({ data: [ATHLETE], isError: true, error: new Error("Failed to fetch") }),
    );
    render(<ClaimPage />);
    expect(screen.getByRole("button", { name: "Doug" })).toBeInTheDocument();
    expect(screen.queryByText(/can't reach the combine/i)).not.toBeInTheDocument();
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

describe("claiming a player", () => {
  async function claim() {
    render(<ClaimPage />);
    await userEvent.click(screen.getByRole("button", { name: /doug/i }));
    await userEvent.type(screen.getByLabelText(/your code/i), "ABC123");
    await userEvent.click(screen.getByRole("button", { name: /^claim$/i }));
  }

  it("re-files the guest's ceremonies before the member token lands", async () => {
    // `claim_guest_secrets` banks the trophy inside the claim itself, and
    // `setMemberToken` is what hands the root ceremony host a participant id to
    // ask about. Between the two, the realtime INSERT can invalidate, refetch and
    // queue a ceremony the pack screen already threw during the guest phase — and
    // the watcher marks it celebrated on the way out, so the duplicate cannot be
    // taken back. The carry used to sit two awaited round trips the other side of
    // that, which narrowed the window rather than closing it.
    await claim();

    expect(carryTrophySeen).toHaveBeenCalledWith("d:dev-1", "p-doug");
    expect(setMemberToken).toHaveBeenCalled();
    expect(carryTrophySeen.mock.invocationCallOrder[0]).toBeLessThan(
      setMemberToken.mock.invocationCallOrder[0],
    );
  });

  it("still waits for the adoption before rewriting the pack row", async () => {
    // The other carry has the opposite constraint and keeps it: the adoption is
    // the record for these cards, so the member must not file them a second time.
    await claim();

    expect(carryPackToIdentity).toHaveBeenCalledWith("d:dev-1", "m:p-doug", expect.anything());
    expect(adoptLocalCollection.mock.invocationCallOrder[0]).toBeLessThan(
      carryPackToIdentity.mock.invocationCallOrder[0],
    );
  });

  it("carries nothing on a code that does not match", async () => {
    claimPlayer.mockResolvedValue({ ok: false, reason: "no_match" });
    await claim();

    expect(carryTrophySeen).not.toHaveBeenCalled();
    expect(setMemberToken).not.toHaveBeenCalled();
  });
});
