// The big screen in front of the party, which is the worst place to be wrong.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import TvPage from "./tv";
import { EVENT_ID, makeBundle, makeParticipant, makeRun, resetFixtureIds } from "@/test/fixtures";

const useEventBundle = vi.fn();

vi.mock("@/hooks/use-event-bundle", () => ({
  useEventBundle: (...args: unknown[]) => useEventBundle(...args),
}));

vi.mock("@/hooks/use-photo-urls", () => ({
  useEventPhotoUrls: () => ({ data: {} }),
  useEventCardUrls: () => ({ data: {} }),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    Link: (props: { to: string; children: ReactNode }) => <a href={props.to}>{props.children}</a>,
  };
});

// Precompiled dists create elements through React.createElement, and a stubbed
// module cannot hand React an undefined element type.
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

function showBundle(over: Parameters<typeof makeBundle>[0], failedTables: string[] = []) {
  useEventBundle.mockReturnValue({
    event: { id: EVENT_ID, name: "Draft Combine", year: 2026, active: true },
    bundle: makeBundle({ ...over, failed: failedTables }),
    loading: false,
    error: null,
    failedTables,
    realtimeDegraded: false,
    refetch: vi.fn(async () => {}),
  });
}

beforeEach(() => {
  resetFixtureIds();
  useEventBundle.mockReset();
});

describe("TvPage standings", () => {
  it("takes a scratched athlete off the board even when they hold the fastest time", () => {
    // Ranking official runs kept them at slot 1 with the whole party watching,
    // while their own card already read dnf.
    const clean = makeParticipant({
      participation_status: "finished",
      participant: { id: "p-clean", name: "Alice Ace", nickname: null },
    });
    const gone = makeParticipant({
      participation_status: "scratched",
      participant: { id: "p-gone", name: "Dave Dropout", nickname: null },
    });
    showBundle({
      participants: [clean, gone],
      runs: [
        makeRun({ participant_id: clean.participant_id, official_time_ms: 90_000 }),
        makeRun({ participant_id: gone.participant_id, official_time_ms: 40_000 }),
      ],
    });

    render(<TvPage />);
    expect(screen.queryByText("Dave Dropout")).toBeNull();
    expect(screen.getByText("Alice Ace")).toBeInTheDocument();
  });

  it("lists somebody re-timed once, at their best run", () => {
    const ep = makeParticipant({
      participation_status: "finished",
      participant: { id: "p-1", name: "Alice Ace", nickname: null },
    });
    showBundle({
      participants: [ep],
      runs: [
        makeRun({ participant_id: ep.participant_id, official_time_ms: 70_000 }),
        makeRun({ participant_id: ep.participant_id, official_time_ms: 55_000 }),
      ],
    });

    render(<TvPage />);
    expect(screen.getAllByText("Alice Ace")).toHaveLength(1);
    expect(screen.getByText("55.00")).toBeInTheDocument();
  });

  it("shares the number on a dead heat rather than numbering it 1 and 2", () => {
    const alice = makeParticipant({
      participation_status: "finished",
      participant: { id: "p-a", name: "Alice Ace", nickname: null },
    });
    const bob = makeParticipant({
      participation_status: "finished",
      participant: { id: "p-b", name: "Bob Bison", nickname: null },
    });
    showBundle({
      participants: [alice, bob],
      runs: [
        makeRun({ participant_id: alice.participant_id, official_time_ms: 60_000 }),
        makeRun({ participant_id: bob.participant_id, official_time_ms: 60_000 }),
      ],
    });

    render(<TvPage />);
    expect(screen.getAllByText("1")).toHaveLength(2);
    expect(screen.queryByText("2")).toBeNull();
  });
});

describe("TvPage when a read has failed", () => {
  it("says the roster read failed rather than showing a wall of em dashes", () => {
    // The big screen has the same blind spot the board had: `standings` ranks
    // from the runs, so a failed roster read fills sixteen slots with correct
    // places, correct times and no names at all.
    showBundle(
      { participants: [], runs: [makeRun({ participant_id: "p-a", official_time_ms: 50_000 })] },
      ["event_participants"],
    );
    render(<TvPage />);

    expect(screen.getByText("Couldn't read the roster just now — retrying")).toBeInTheDocument();
  });

  it("does not claim the results were unreadable when only the splits failed", () => {
    showBundle({ participants: [], runs: [] }, ["splits"]);
    render(<TvPage />);

    expect(screen.getByText("No official times yet.")).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't read the results/)).toBeNull();
  });

  it("does not blame the results when only the roster failed before anyone finished", () => {
    // The roster banner is the true sentence here; the empty board is a combine
    // with no official times, which a failed roster read cannot cause.
    showBundle({ participants: [], runs: [] }, ["event_participants"]);
    render(<TvPage />);

    expect(screen.getByText("No official times yet.")).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't read the results/)).toBeNull();
    expect(screen.getByText("Couldn't read the roster just now — retrying")).toBeInTheDocument();
  });
});
