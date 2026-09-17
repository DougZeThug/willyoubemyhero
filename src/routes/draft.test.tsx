// The picking order is the leaderboard's order, and that is the whole contract.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import DraftPage from "./draft";
import { EVENT_ID, makeBundle, makeParticipant, makeRun, resetFixtureIds } from "@/test/fixtures";

const useEventBundle = vi.fn();

vi.mock("@/hooks/use-event-bundle", () => ({
  useEventBundle: (...args: unknown[]) => useEventBundle(...args),
}));

vi.mock("@/hooks/use-photo-urls", () => ({
  useEventPhotoUrls: () => ({ data: {} }),
  useEventCardUrls: () => ({ data: {} }),
}));

vi.mock("@/lib/admin-token", () => ({ useAdminSession: () => null }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/lib/admin-write.functions", () => ({
  recordDraftSelection: vi.fn(),
  undoLastDraftSelection: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
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

function showBundle(over: Parameters<typeof makeBundle>[0]) {
  useEventBundle.mockReturnValue({
    event: { id: EVENT_ID, name: "Draft Combine", year: 2026, active: true },
    bundle: makeBundle(over),
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
});

describe("DraftPage picking order", () => {
  it("puts the fastest athlete in contention on the clock, not a scratched one", () => {
    // The board dropped them and this screen kept them, so a scratched athlete
    // holding the fastest clock took the first pick off the honest winner.
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

    render(<DraftPage />);
    expect(screen.getByText("On the clock")).toBeInTheDocument();
    expect(screen.getByText("Alice Ace")).toBeInTheDocument();
    expect(screen.queryByText("Dave Dropout")).toBeNull();
  });

  it("quotes an athlete's best run when they were re-timed", () => {
    // Held before this change too -- sorting runs by time surfaced the fast one
    // either way. Here to pin it, because the order is now built from a helper
    // that reduces to one row per athlete rather than sorting and taking the
    // first, and that reduction is the part that could quietly pick the wrong run.
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

    render(<DraftPage />);
    expect(screen.getByText("Combine time 55.00")).toBeInTheDocument();
  });

  it("opens no board at all when the only official run belongs to a scratched athlete", () => {
    const gone = makeParticipant({
      participation_status: "scratched",
      participant: { id: "p-gone", name: "Dave Dropout", nickname: null },
    });
    showBundle({
      participants: [gone],
      runs: [makeRun({ participant_id: gone.participant_id, official_time_ms: 40_000 })],
    });

    render(<DraftPage />);
    expect(
      screen.getByText("No combine results yet. Draft board opens once athletes finish."),
    ).toBeInTheDocument();
  });
});
