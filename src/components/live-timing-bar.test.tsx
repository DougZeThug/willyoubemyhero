import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LiveTimingBar } from "./live-timing-bar";
import type { RunConsole } from "@/hooks/use-run-console";

function ep(id: string, name: string, order: number, status = "waiting") {
  return {
    id,
    participant_id: `p-${id}`,
    running_order: order,
    participation_status: status,
    participant: { name, profile_image_url: null, fantasy_team_name: null },
  };
}

function console_(over: Partial<RunConsole> = {}): RunConsole {
  return {
    event: { id: "e1" },
    run: null,
    participants: [ep("a", "Ryan", 1), ep("b", "Dave", 2)],
    stations: [
      { id: "s1", name: "Cornhole", short_name: "CORN", station_order: 1, active: true },
      { id: "s2", name: "Beer Pong", short_name: null, station_order: 2, active: true },
    ],
    currentEp: null,
    paused: false,
    finished: false,
    finishing: false,
    elapsed: 0,
    finishedRun: null,
    finishSave: { state: "idle", error: null, finish: vi.fn(), retry: vi.fn(), reset: vi.fn() },
    statusLabel: "Running",
    usedStationIds: new Set<string>(),
    selectedParticipantId: "",
    setSelected: vi.fn(),
    startRun: vi.fn(),
    togglePause: vi.fn(),
    recordSplit: vi.fn(),
    undoLastSplit: vi.fn(),
    addPenalty: vi.fn(),
    finishRun: vi.fn(),
    cancelRun: vi.fn(),
    setOnClock: vi.fn(),
    ...over,
  } as unknown as RunConsole;
}

const RUN = {
  clientKey: "k1",
  eventId: "e1",
  participantId: "p-a",
  status: "running" as const,
  startedAt: 0,
  startedAtIso: new Date(0).toISOString(),
  pauses: [],
  splits: [],
  penalties: [],
};

describe("LiveTimingBar", () => {
  it("starts the athlete the running order says is next", async () => {
    const rc = console_();
    render(<LiveTimingBar console={rc} />);
    await userEvent.click(screen.getByRole("button", { name: /start timer/i }));
    expect(rc.startRun).toHaveBeenCalled();
  });

  it("records a split per station while running", async () => {
    const rc = console_({ run: RUN as never, currentEp: ep("a", "Ryan", 1) as never });
    render(<LiveTimingBar console={rc} />);
    await userEvent.click(screen.getByRole("button", { name: /corn/i }));
    expect(rc.recordSplit).toHaveBeenCalledWith("s1");
  });

  it("locks the split buttons while paused", () => {
    const rc = console_({
      run: { ...RUN, status: "paused" } as never,
      paused: true,
      currentEp: ep("a", "Ryan", 1) as never,
    });
    render(<LiveTimingBar console={rc} />);
    expect(screen.getByRole("button", { name: /corn/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /resume/i })).toBeEnabled();
  });

  it("offers a retry, not a finish, when the save did not land", () => {
    const rc = console_({
      run: { ...RUN, status: "finished" } as never,
      finished: true,
      finishedRun: { ...RUN, status: "finished", finishedAt: 1, finishedAtIso: "x" } as never,
      finishSave: {
        state: "failed",
        error: "Offline.",
        finish: vi.fn(),
        retry: vi.fn(),
        reset: vi.fn(),
      } as never,
      currentEp: ep("a", "Ryan", 1) as never,
    });
    render(<LiveTimingBar console={rc} />);
    expect(screen.getByRole("button", { name: /retry save/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /finish/i })).toBeNull();
  });
});
