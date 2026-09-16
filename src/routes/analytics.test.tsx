// Does mocking lucide-react with simple stubs fix the two empty-splits tests?
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import AnalyticsPage from "./analytics";
import {
  EVENT_ID,
  makeBundle,
  makeParticipant,
  makeRun,
  makeStation,
  resetFixtureIds,
} from "@/test/fixtures";

const useEventBundle = vi.fn();

vi.mock("@/hooks/use-event-bundle", () => ({
  useEventBundle: (...args: unknown[]) => useEventBundle(...args),
}));

vi.mock("@/lib/media.functions", () => ({
  listArchives: vi.fn(async () => []),
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

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(() => ({ data: undefined })),
}));

// Stub the classic-runtime icon and chart libraries: their precompiled dists
// create elements through React.createElement, and a stubbed module cannot
// hand React an undefined element type.
vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const stubs: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(actual)) {
    if (typeof value === "function") {
      stubs[name] = (props: Record<string, unknown>) => <svg data-lucide-stub={name} {...props} />;
    } else {
      stubs[name] = value;
    }
  }
  return stubs;
});

vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const stubs: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(actual)) {
    if (typeof value === "function") {
      stubs[name] = (props: Record<string, unknown>) => (
        <svg data-recharts-stub={name} {...props} />
      );
    } else {
      stubs[name] = value;
    }
  }
  return stubs;
});

function healthyBundle() {
  return makeBundle();
}

beforeEach(() => {
  resetFixtureIds();
  useEventBundle.mockReset();
  useEventBundle.mockReturnValue({
    event: { id: EVENT_ID, name: "Draft Combine", year: 2026, active: true },
    bundle: healthyBundle(),
    loading: false,
    error: null,
    failedTables: [],
    realtimeDegraded: false,
    refetch: vi.fn(async () => {}),
  });
});

describe("AnalyticsPage station averages", () => {
  it("shows the split-read failure when only stations succeeded", async () => {
    useEventBundle.mockReturnValue({
      event: null,
      bundle: makeBundle({ failed: ["splits"] }),
      loading: false,
      error: null,
      failedTables: ["splits"],
      realtimeDegraded: false,
      refetch: vi.fn(async () => {}),
    });
    render(<AnalyticsPage />);
    await waitFor(() =>
      expect(screen.getByText("Couldn't read the splits just now — retrying.")).toBeInTheDocument(),
    );
    expect(screen.queryByText("No split data yet.")).not.toBeInTheDocument();
  });

  it("says there is no split data yet when the read came back empty", () => {
    render(<AnalyticsPage />);
    expect(screen.getByText("No split data yet.")).toBeInTheDocument();
  });

  it("says there is no split data yet when stations exist but nobody has run", () => {
    useEventBundle.mockReturnValue({
      event: { id: EVENT_ID, name: "Draft Combine", year: 2026, active: true },
      bundle: makeBundle({
        stations: [makeStation({ name: "Sled Push", short_name: "SLED", station_order: 1 })],
      }),
      loading: false,
      error: null,
      failedTables: [],
      realtimeDegraded: false,
      refetch: vi.fn(async () => {}),
    });
    render(<AnalyticsPage />);
    expect(screen.getByText("No split data yet.")).toBeInTheDocument();
  });
});

describe("AnalyticsPage personal bests", () => {
  it("drops a scratched athlete the leaderboard has already dropped", () => {
    // Both routes are public and read one bundle. Filtering official runs without
    // asking about contention let this screen name a fastest athlete that
    // /leaderboard did not, live, the moment the commissioner scratched them.
    const clean = makeParticipant({
      participation_status: "finished",
      participant: { id: "p-clean", name: "Alice Ace", nickname: null },
    });
    const gone = makeParticipant({
      participation_status: "scratched",
      participant: { id: "p-gone", name: "Dave Dropout", nickname: null },
    });
    useEventBundle.mockReturnValue({
      event: { id: EVENT_ID, name: "Draft Combine", year: 2026, active: true },
      bundle: makeBundle({
        participants: [clean, gone],
        runs: [
          makeRun({ participant_id: clean.participant_id, official_time_ms: 90_000 }),
          makeRun({ participant_id: gone.participant_id, official_time_ms: 40_000 }),
        ],
      }),
      loading: false,
      error: null,
      failedTables: [],
      realtimeDegraded: false,
      refetch: vi.fn(async () => {}),
    });

    render(<AnalyticsPage />);
    expect(screen.queryByText("Dave Dropout")).toBeNull();
    expect(screen.getByText("Alice Ace")).toBeInTheDocument();
    expect(screen.getByText("1:30.00")).toBeInTheDocument();
  });

  it("gives two athletes who share a name distinct keys", () => {
    // key={b.name} collided. React warns and its reconciliation of the list stops
    // being defined across updates — and this list re-renders on every realtime
    // nudge, which is exactly when a row would swap its time for the other Dave's.
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    const a = makeParticipant({
      participation_status: "finished",
      participant: { id: "p-a", name: "Dave", nickname: null },
    });
    const b = makeParticipant({
      participation_status: "finished",
      participant: { id: "p-b", name: "Dave", nickname: null },
    });
    useEventBundle.mockReturnValue({
      event: { id: EVENT_ID, name: "Draft Combine", year: 2026, active: true },
      bundle: makeBundle({
        participants: [a, b],
        runs: [
          makeRun({ participant_id: a.participant_id, official_time_ms: 50_000 }),
          makeRun({ participant_id: b.participant_id, official_time_ms: 60_000 }),
        ],
      }),
      loading: false,
      error: null,
      failedTables: [],
      realtimeDegraded: false,
      refetch: vi.fn(async () => {}),
    });

    render(<AnalyticsPage />);
    expect(screen.getAllByText("Dave")).toHaveLength(2);
    expect(warn.mock.calls.flat().join(" ")).not.toMatch(/same key/i);
    warn.mockRestore();
  });

  it("leaves out an athlete whose only official run has no time yet", () => {
    // Math.min over `?? Infinity` gave them a top-ten row with an em dash where
    // the time belongs — the state a live combine passes through every run.
    const timed = makeParticipant({
      participation_status: "finished",
      participant: { id: "p-t", name: "Alice Ace", nickname: null },
    });
    const untimed = makeParticipant({
      participation_status: "finished",
      participant: { id: "p-u", name: "Bob Bison", nickname: null },
    });
    useEventBundle.mockReturnValue({
      event: { id: EVENT_ID, name: "Draft Combine", year: 2026, active: true },
      bundle: makeBundle({
        participants: [timed, untimed],
        runs: [
          makeRun({ participant_id: timed.participant_id, official_time_ms: 60_000 }),
          makeRun({ participant_id: untimed.participant_id, official_time_ms: null }),
        ],
      }),
      loading: false,
      error: null,
      failedTables: [],
      realtimeDegraded: false,
      refetch: vi.fn(async () => {}),
    });

    render(<AnalyticsPage />);
    expect(screen.queryByText("Bob Bison")).toBeNull();
    expect(screen.getByText("Alice Ace")).toBeInTheDocument();
  });
});
