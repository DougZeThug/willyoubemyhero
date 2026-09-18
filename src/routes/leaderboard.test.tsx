// Thirteen share buttons, one offscreen card between them.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import LeaderboardPage from "./leaderboard";
import { EVENT_ID, makeBundle, makeParticipant, makeRun, resetFixtureIds } from "@/test/fixtures";

const useEventBundle = vi.fn();
const exportCardPng = vi.fn();

vi.mock("@/hooks/use-event-bundle", () => ({
  useEventBundle: (...args: unknown[]) => useEventBundle(...args),
}));

vi.mock("@/hooks/use-photo-urls", () => ({
  useEventPhotoUrls: () => ({ data: {} }),
  useEventCardUrls: () => ({ data: {} }),
}));

vi.mock("@/lib/share-card", () => ({
  exportCardPng: (...args: unknown[]) => exportCardPng(...args),
  waitForPaint: vi.fn(async () => {}),
}));

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

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

function twoFinishers() {
  const alice = makeParticipant({
    participation_status: "finished",
    participant: { id: "p-a", name: "Alice Ace", nickname: null },
  });
  const bob = makeParticipant({
    participation_status: "finished",
    participant: { id: "p-b", name: "Bob Bison", nickname: null },
  });
  useEventBundle.mockReturnValue({
    event: { id: EVENT_ID, name: "Draft Combine", year: 2026, active: true },
    bundle: makeBundle({
      participants: [alice, bob],
      runs: [
        makeRun({ participant_id: alice.participant_id, official_time_ms: 50_000 }),
        makeRun({ participant_id: bob.participant_id, official_time_ms: 60_000 }),
      ],
    }),
    loading: false,
    error: null,
    failedTables: [],
    realtimeDegraded: false,
    refetch: vi.fn(async () => {}),
  });
}

beforeEach(() => {
  resetFixtureIds();
  useEventBundle.mockReset();
  exportCardPng.mockReset();
});

describe("LeaderboardPage sharing", () => {
  it("disables every share button while one export is in flight", async () => {
    // Only the clicked row used to go inert, so a second tap repointed the one
    // offscreen ResultCard mid-export and A's PNG rasterised B — the wrong
    // athlete, under the right filename, straight into the group chat.
    twoFinishers();
    exportCardPng.mockReturnValue(new Promise(() => {}));

    render(<LeaderboardPage />);
    const buttons = screen.getAllByRole("button", { name: /share .* result card/i });
    expect(buttons).toHaveLength(2);

    await userEvent.click(buttons[0]);

    await waitFor(() => {
      for (const b of screen.getAllByRole("button", { name: /share .* result card/i })) {
        expect(b).toBeDisabled();
      }
    });
  });

  it("hands the buttons back once the export settles", async () => {
    twoFinishers();
    // beforeEach resets it to a bare vi.fn(), whose undefined return awaits
    // straight through — an export that settles on the next tick.

    render(<LeaderboardPage />);
    const buttons = screen.getAllByRole("button", { name: /share .* result card/i });
    await userEvent.click(buttons[0]);

    await waitFor(() => {
      for (const b of screen.getAllByRole("button", { name: /share .* result card/i })) {
        expect(b).toBeEnabled();
      }
    });
    expect(exportCardPng).toHaveBeenCalledTimes(1);
  });
});

/**
 * The bundle coalesces a failed table read to an empty array, so the only thing
 * that tells a broken read from an empty combine is `failedTables` — and this
 * screen used to consult it on exactly one branch, the one it cannot reach when
 * the read that failed was the roster.
 */
describe("LeaderboardPage when a read has failed", () => {
  /** The board as it comes back when `event_participants` is the table that broke. */
  function boardWithoutRoster(failed: string[]) {
    useEventBundle.mockReturnValue({
      event: { id: EVENT_ID, name: "Draft Combine", year: 2026, active: true },
      bundle: makeBundle({
        participants: [],
        runs: [
          makeRun({ participant_id: "p-a", official_time_ms: 50_000 }),
          makeRun({ participant_id: "p-b", official_time_ms: 60_000 }),
        ],
        failed,
      }),
      loading: false,
      error: null,
      failedTables: failed,
      realtimeDegraded: false,
      refetch: vi.fn(async () => {}),
    });
  }

  function emptyBoard(failed: string[]) {
    useEventBundle.mockReturnValue({
      event: { id: EVENT_ID, name: "Draft Combine", year: 2026, active: true },
      bundle: makeBundle({ participants: [], runs: [], failed }),
      loading: false,
      error: null,
      failedTables: failed,
      realtimeDegraded: false,
      refetch: vi.fn(async () => {}),
    });
  }

  it("says the roster read failed over a board that still has rows on it", async () => {
    // `standings` ranks from the runs and drops its roster filter when the
    // roster is empty, so this is a full board of correctly-placed em dashes.
    // It is the case the signal most needed to cover and the only one it could
    // not reach, because the screen is not empty.
    boardWithoutRoster(["event_participants"]);
    render(<LeaderboardPage />);

    expect(screen.getByText("Couldn't read the roster just now — retrying.")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("50.00")).toBeInTheDocument();
  });

  it("says nothing of the sort when every read worked", () => {
    twoFinishers();
    render(<LeaderboardPage />);

    expect(screen.queryByText(/Couldn't read the roster/)).toBeNull();
    expect(screen.getByText("Alice Ace")).toBeInTheDocument();
  });

  it("keeps the empty board honest when the failure cannot have emptied it", () => {
    // Splits, penalties, stations, draft picks and the event row are all in
    // `failedTables` too, and none of them feeds a row. Claiming the results
    // were unreadable over a combine nobody has run yet is the same lie in the
    // other direction.
    emptyBoard(["splits"]);
    render(<LeaderboardPage />);

    expect(
      screen.getByText("No official times yet — check back after the first athlete crosses."),
    ).toBeInTheDocument();
  });

  it("still names a failed runs read on an empty board", () => {
    emptyBoard(["runs"]);
    render(<LeaderboardPage />);

    expect(screen.getByText("Couldn't read the results just now — retrying.")).toBeInTheDocument();
  });
});
