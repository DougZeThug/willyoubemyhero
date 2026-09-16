// The spectator screen behind the QR code, where the Top 5 and the done counter
// sit one above the other and must agree.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import LivePage from "./live";
import { EVENT_ID, makeBundle, makeParticipant, makeRun, resetFixtureIds } from "@/test/fixtures";

const useEventBundle = vi.fn();

vi.mock("@/hooks/use-event-bundle", () => ({
  useEventBundle: (...args: unknown[]) => useEventBundle(...args),
}));

vi.mock("@/hooks/use-photo-urls", () => ({
  useEventPhotoUrls: () => ({ data: {} }),
  useEventCardUrls: () => ({ data: {} }),
}));

vi.mock("@/hooks/use-finish-watcher", () => ({ useFinishWatcher: () => {} }));
vi.mock("@/hooks/use-run-console", () => ({ useRunConsole: () => ({ run: null }) }));
vi.mock("@/lib/admin-token", () => ({ useAdminSession: () => null }));
vi.mock("@/components/hud-timer", () => ({ HudTimer: () => <div data-stub="hud-timer" /> }));
vi.mock("@/components/finish-celebration", () => ({
  FinishCelebration: () => <div data-stub="finish-celebration" />,
}));
vi.mock("@/components/live-timing-bar", () => ({
  LiveTimingBar: () => <div data-stub="live-timing-bar" />,
}));

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

describe("LivePage standings", () => {
  it("lists somebody re-timed once in the Top 5, and the counter agrees", () => {
    // The Top 5 ranked runs while the counter beside it already counted
    // athletes, so a re-timed athlete made the screen contradict itself.
    const twice = makeParticipant({
      participation_status: "finished",
      participant: { id: "p-1", name: "Alice Ace", nickname: null },
    });
    const once = makeParticipant({
      participation_status: "finished",
      participant: { id: "p-2", name: "Bob Bison", nickname: null },
    });
    showBundle({
      participants: [twice, once],
      runs: [
        makeRun({ participant_id: twice.participant_id, official_time_ms: 70_000 }),
        makeRun({ participant_id: twice.participant_id, official_time_ms: 55_000 }),
        makeRun({ participant_id: once.participant_id, official_time_ms: 80_000 }),
      ],
    });

    render(<LivePage />);
    expect(screen.getAllByText("Alice Ace")).toHaveLength(1);
    expect(screen.getByText("2/2 done")).toBeInTheDocument();
  });

  it("counts a dq'd run out of both halves, so the field can finish", () => {
    // standings() drops an athlete on a run marked dq even when their roster row
    // says finished, but fieldSize only ever sees the roster — so the dq'd one
    // stayed in the denominator and the tally could never close.
    const clean = makeParticipant({
      participation_status: "finished",
      participant: { id: "p-c", name: "Alice Ace", nickname: null },
    });
    const dqd = makeParticipant({
      participation_status: "finished",
      participant: { id: "p-d", name: "Dave Dropout", nickname: null },
    });
    showBundle({
      participants: [clean, dqd],
      runs: [
        makeRun({ participant_id: clean.participant_id, official_time_ms: 60_000 }),
        makeRun({ participant_id: dqd.participant_id, official_time_ms: 40_000, status: "dq" }),
      ],
    });

    render(<LivePage />);
    expect(screen.getByText("1/1 done")).toBeInTheDocument();
    expect(screen.getByText("Every athlete is done. Nice work.")).toBeInTheDocument();
    expect(screen.queryByText("Dave Dropout")).toBeNull();
  });

  it("does not congratulate the field while a scratched athlete pads the count", () => {
    // done counted every athlete with an official run, total left the scratched
    // out — so one scratched finisher pushed done past total and the screen said
    // "Every athlete is done. Nice work." over a queue that was still moving.
    const queued = makeParticipant({
      participation_status: "queued",
      participant: { id: "p-q", name: "Cara Carter", nickname: null },
    });
    const gone = makeParticipant({
      participation_status: "scratched",
      participant: { id: "p-g", name: "Dave Dropout", nickname: null },
    });
    showBundle({
      participants: [queued, gone],
      runs: [makeRun({ participant_id: gone.participant_id, official_time_ms: 40_000 })],
    });

    render(<LivePage />);
    expect(screen.queryByText("Every athlete is done. Nice work.")).toBeNull();
    expect(screen.getByText("0/1 done")).toBeInTheDocument();
    expect(screen.queryByText("Dave Dropout")).toBeNull();
  });
});
