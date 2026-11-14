import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SplitStrip } from "@/components/admin/split-strip";
import type { RunConsole } from "@/hooks/use-run-console";

function strip(status: "running" | "paused" | "finished", splits = [] as unknown[]) {
  const rc = {
    run: { status, splits },
    stations: [
      { id: "s1", name: "Cornhole", short_name: "CORN", station_order: 1, penalty_amount_ms: 5000 },
      { id: "s2", name: "Beer Pong", short_name: null, station_order: 2, penalty_amount_ms: 0 },
    ],
    recordSplit: vi.fn(),
    undoLastSplit: vi.fn(),
    addPenalty: vi.fn(),
  } as unknown as RunConsole;
  return rc;
}

describe("SplitStrip", () => {
  it("records a split on a running clock, and only for a station without one", async () => {
    const rc = strip("running", [{ stationId: "s2", cumulative_time_ms: 12_340 }]);
    render(<SplitStrip runConsole={rc} compact />);
    await userEvent.click(screen.getByRole("button", { name: /CORN/ }));
    expect(rc.recordSplit).toHaveBeenCalledWith("s1");
    expect(screen.getByRole("button", { name: /Beer Pong/ })).toBeDisabled();
    expect(screen.getByText("12.34")).toBeInTheDocument();
  });

  it("records nothing once the clock is not running, and cannot undo a finished run", () => {
    for (const status of ["paused", "finished"] as const) {
      const { unmount } = render(
        <SplitStrip runConsole={strip(status, [{ stationId: "s2", cumulative_time_ms: 1000 }])} />,
      );
      expect(screen.getByRole("button", { name: /Cornhole/ })).toBeDisabled();
      const undo = screen.getByRole("button", { name: /Undo split/ });
      if (status === "finished") expect(undo).toBeDisabled();
      else expect(undo).toBeEnabled();
      unmount();
    }
  });

  it("offers penalties in the console shape only, and not on a finished run", () => {
    render(<SplitStrip runConsole={strip("finished")} />);
    expect(screen.getByRole("button", { name: /05\.00 pen/ })).toBeDisabled();
  });
});
