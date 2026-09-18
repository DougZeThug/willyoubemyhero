// The reveal, which is the feature's headline moment and the one place the
// screen must not state something it has not read yet.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import AwardsPage from "./awards";
import { EVENT_ID, makeBundle, makeParticipant, resetFixtureIds } from "@/test/fixtures";

const useEventBundle = vi.fn();
const useEventAwards = vi.fn();

vi.mock("@/hooks/use-event-bundle", () => ({
  useEventBundle: (...args: unknown[]) => useEventBundle(...args),
}));

vi.mock("@/hooks/use-event-social", () => ({
  useEventAwards: (...args: unknown[]) => useEventAwards(...args),
}));

vi.mock("@/hooks/use-photo-urls", () => ({
  useEventPhotoUrls: () => ({ data: {} }),
  useEventCardUrls: () => ({ data: {} }),
}));

vi.mock("@/lib/member-token", () => ({ useMemberSession: () => null }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/lib/social.functions", () => ({
  castAwardVote: vi.fn(),
  getMyAwardVotes: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(() => ({ data: [] })),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    Link: (props: { to: string; children: ReactNode }) => <a href={props.to}>{props.children}</a>,
  };
});

vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const stubs: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(actual)) {
    stubs[name] =
      typeof value === "function"
        ? (props: Record<string, unknown>) => <svg data-lucide-stub={name} {...props} />
        : value;
  }
  return stubs;
});

/**
 * The tally, shaped as useEventAwards hands it over.
 *
 * `lockedAtRead` is the load-bearing field: getAwards reads awards_locked before
 * the rows, so it says whether THIS list was read with voting already closed.
 * Defaulting it false is the pre-first-read state.
 */
function awardsQuery(over: Record<string, unknown>) {
  return {
    winners: [],
    lockedAtRead: false,
    isPending: false,
    isFetching: false,
    isLoading: false,
    isError: false,
    byParticipant: new Map(),
    ...over,
  };
}

function lockedEvent() {
  const ep = makeParticipant({
    participation_status: "finished",
    participant: { id: "p-1", name: "Alice Ace", nickname: null },
  });
  useEventBundle.mockReturnValue({
    event: { id: EVENT_ID, name: "Draft Combine", year: 2026, active: true, awards_locked: true },
    bundle: makeBundle({ participants: [ep] }),
    loading: false,
    error: null,
    failedTables: [],
    realtimeDegraded: false,
    refetch: vi.fn(async () => {}),
  });
  return ep;
}

beforeEach(() => {
  resetFixtureIds();
  useEventBundle.mockReset();
  useEventAwards.mockReset();
});

describe("AwardsPage locked reveal", () => {
  it("does not claim nobody voted over a tally read before the lock", () => {
    // The flip race: `locked` comes off the event row and the winners off a query
    // of their own, both invalidated at once, so `locked` flips on whichever
    // answers first. A list read while voting was open cannot say who won, and
    // lockedAtRead false is exactly that list.
    lockedEvent();
    useEventAwards.mockReturnValue(awardsQuery({ winners: [], lockedAtRead: false }));

    render(<AwardsPage />);
    expect(screen.queryByText("No votes cast.")).toBeNull();
    expect(screen.getAllByText("Counting the votes…").length).toBeGreaterThan(0);
  });

  it("says nobody voted for an empty tally that WAS read under the lock", () => {
    // Read with awards_locked already set, and close_award_voting publishes the
    // winners before it sets that flag — so empty here is the settled answer.
    lockedEvent();
    useEventAwards.mockReturnValue(awardsQuery({ winners: [], lockedAtRead: true }));

    render(<AwardsPage />);
    expect(screen.getAllByText("No votes cast.").length).toBeGreaterThan(0);
    expect(screen.queryByText("Counting the votes…")).toBeNull();
  });

  it("keeps saying nobody voted through the backstop poll's refetches", () => {
    // The shared channel nudges this key every fifteen seconds while the tab is
    // visible. Deciding from isFetching and an empty array meant a closed combine
    // where nobody voted flipped to "Counting the votes…" on every tick, forever,
    // about a count that had finished hours earlier. A refetch in flight says
    // nothing now; what the list was read under does.
    lockedEvent();
    useEventAwards.mockReturnValue(awardsQuery({ winners: [], lockedAtRead: true }));
    const { rerender } = render(<AwardsPage />);
    expect(screen.getAllByText("No votes cast.").length).toBeGreaterThan(0);

    useEventAwards.mockReturnValue(
      awardsQuery({ winners: [], lockedAtRead: true, isFetching: true }),
    );
    rerender(<AwardsPage />);

    expect(screen.getAllByText("No votes cast.").length).toBeGreaterThan(0);
    expect(screen.queryByText("Counting the votes…")).toBeNull();
  });

  it("counts, rather than settling, while the very first read is still out", () => {
    // isPending with nothing read yet: lockedAtRead defaults false, which is the
    // honest answer -- a tally cannot speak for a result it has not seen.
    lockedEvent();
    useEventAwards.mockReturnValue(awardsQuery({ isPending: true, isFetching: true }));

    render(<AwardsPage />);
    expect(screen.queryByText("No votes cast.")).toBeNull();
    expect(screen.getAllByText("Counting the votes…").length).toBeGreaterThan(0);
  });

  it("keeps the failed read distinct from both of them", () => {
    lockedEvent();
    useEventAwards.mockReturnValue(awardsQuery({ isError: true }));

    render(<AwardsPage />);
    expect(screen.getAllByText("Couldn't read the votes just now — retrying.").length).toBe(6);
    expect(screen.queryByText("No votes cast.")).toBeNull();
  });

  it("does not flicker back to counting once winners have landed", () => {
    // Every comment and reaction nudges this key, and a reveal that blinks its
    // winners away on each one reads as the tally being recounted.
    const ep = lockedEvent();
    useEventAwards.mockReturnValue(
      awardsQuery({
        winners: [{ award_type: "mvp", participant_id: ep.participant_id }],
        lockedAtRead: true,
        isFetching: true,
      }),
    );

    render(<AwardsPage />);
    expect(screen.getByText("Alice Ace")).toBeInTheDocument();
  });
});
