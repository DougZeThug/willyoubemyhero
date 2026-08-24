import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StreakFlame } from "./streak-flame";
import type { Streak } from "@/lib/streaks";

const alive: Streak = {
  current: 6,
  startedOn: "2026-08-19",
  lastOpenedOn: "2026-08-24",
  openedToday: true,
};

function renderFlame(over: Partial<React.ComponentProps<typeof StreakFlame>> = {}) {
  return render(<StreakFlame streak={alive} {...over} />);
}

describe("StreakFlame", () => {
  it("says nothing at all before there is a streak", () => {
    // A first pack should be a first pack, not a progress bar reading zero.
    const { container } = renderFlame({
      streak: { current: 0, startedOn: null, lastOpenedOn: null, openedToday: false },
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the day count", () => {
    renderFlame();
    expect(screen.getByTestId("streak-flame")).toHaveTextContent("6");
  });

  it("carries exactly one test id, never the collected counter's", () => {
    // Two nodes answering to `collected-count` on one screen is a trap the e2e
    // suite would walk into.
    renderFlame();
    expect(screen.getAllByTestId("streak-flame")).toHaveLength(1);
    expect(screen.queryByTestId("collected-count")).toBeNull();
  });

  it("stops the flame animating once the run is at risk", () => {
    // The pulse means "alive today". A run waiting on today's pack should not
    // look like one that is already safe.
    const { container } = renderFlame({ streak: { ...alive, openedToday: false } });
    expect(container.querySelector(".streak-flame-pulse")).toBeNull();
  });

  it("animates it while the run is alive", () => {
    const { container } = renderFlame();
    expect(container.querySelector(".streak-flame-pulse")).not.toBeNull();
  });
});
