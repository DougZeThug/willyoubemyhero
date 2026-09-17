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
    // WITH the athlete, not just at all. The picker defaults to whoever is next
    // without writing that to the console's selection, so a Start that passed
    // nothing left the hook reading an empty string and returning — an enabled
    // button that started no timer and said nothing. Asserting only that the
    // click landed is what let that ship.
    const rc = console_();
    render(<LiveTimingBar console={rc} />);
    await userEvent.click(screen.getByRole("button", { name: /start timer/i }));
    expect(rc.startRun).toHaveBeenCalledWith("p-a");
  });

  it("starts the athlete the commissioner picked once they have picked one", async () => {
    const rc = console_({ selectedParticipantId: "p-b" });
    render(<LiveTimingBar console={rc} />);
    await userEvent.click(screen.getByRole("button", { name: /start timer/i }));
    expect(rc.startRun).toHaveBeenCalledWith("p-b");
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

  it("will not throw the timer away while the save is still going", () => {
    // Admin's Discard already refuses while a save is in flight; this bar was
    // the one door left open on it, and "nothing is written to the league" —
    // what the confirm promises — is not true of a row still being written.
    const rc = console_({
      run: { ...RUN, status: "finished" } as never,
      finished: true,
      finishing: true,
      finishedRun: { ...RUN, status: "finished", finishedAt: 1, finishedAtIso: "x" } as never,
      finishSave: {
        state: "saving",
        error: null,
        finish: vi.fn(),
        retry: vi.fn(),
        reset: vi.fn(),
      } as never,
      currentEp: ep("a", "Ryan", 1) as never,
    });
    render(<LiveTimingBar console={rc} />);
    expect(screen.getByRole("button", { name: /reset timer/i })).toBeDisabled();
  });

  it("offers it again once the save has settled", () => {
    const rc = console_({
      run: { ...RUN, status: "finished" } as never,
      finished: true,
      finishedRun: { ...RUN, status: "finished", finishedAt: 1, finishedAtIso: "x" } as never,
      currentEp: ep("a", "Ryan", 1) as never,
    });
    render(<LiveTimingBar console={rc} />);
    expect(screen.getByRole("button", { name: /reset timer/i })).toBeEnabled();
  });
});
