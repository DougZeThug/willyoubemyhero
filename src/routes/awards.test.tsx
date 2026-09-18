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

/** The tally query, shaped as React Query hands it over. */
function awardsQuery(over: Record<string, unknown>) {
  return {
    data: [],
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
  it("does not claim nobody voted while the tally is still being refetched", () => {
    // close_award_voting writes the winners and flips awards_locked together, and
    // the realtime handler invalidates both queries at once — so `locked` flips on
    // whichever answers first, over the empty array cached while voting was open.
    lockedEvent();
    useEventAwards.mockReturnValue(awardsQuery({ data: [], isFetching: true }));

    render(<AwardsPage />);
    expect(screen.queryByText("No votes cast.")).toBeNull();
    expect(screen.getAllByText("Counting the votes…").length).toBeGreaterThan(0);
  });

  it("still says nobody voted once the tally has settled empty", () => {
    // The sentence is a settled fact, and has to keep being sayable.
    lockedEvent();
    useEventAwards.mockReturnValue(awardsQuery({ data: [] }));

    render(<AwardsPage />);
    expect(screen.getAllByText("No votes cast.").length).toBeGreaterThan(0);
    expect(screen.queryByText("Counting the votes…")).toBeNull();
  });

  it("keeps saying nobody voted through the backstop poll's refetches", () => {
    // The sentence above is settled, and the thing that kept unsettling it was
    // the shared channel: it nudges this key every fifteen seconds while the tab
    // is visible, and an empty `data` under isFetching used to read as the tally
    // still being counted. On a closed combine where nobody voted that is a
    // reveal that flips to "Counting the votes…" every fifteen seconds about a
    // count that already finished.
    lockedEvent();
    useEventAwards.mockReturnValue(awardsQuery({ data: [] }));
    const { rerender } = render(<AwardsPage />);
    expect(screen.getAllByText("No votes cast.").length).toBeGreaterThan(0);

    useEventAwards.mockReturnValue(awardsQuery({ data: [], isFetching: true }));
    rerender(<AwardsPage />);

    expect(screen.getAllByText("No votes cast.").length).toBeGreaterThan(0);
    expect(screen.queryByText("Counting the votes…")).toBeNull();
  });

  it("keeps the failed read distinct from both of them", () => {
    lockedEvent();
    useEventAwards.mockReturnValue(awardsQuery({ data: undefined, isError: true }));

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
        data: [{ award_type: "mvp", participant_id: ep.participant_id }],
        isFetching: true,
      }),
    );

    render(<AwardsPage />);
    expect(screen.getByText("Alice Ace")).toBeInTheDocument();
  });
});
