// The spectator clock on /live and /tv.
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { HudTimer } from "./hud-timer";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("HudTimer", () => {
  // The crowd's clock reads the same way as every other duration in the app.
  // It used to print 12:34 for what the leaderboard calls 12.34, which reads as
  // twelve minutes to anybody arriving from the board.
  it("shows SS.cc below a minute, the same as formatTime", () => {
    render(<HudTimer runningSinceMs={12_340} paused status="Standby" />);
    expect(screen.getByText(/^12\.34$/)).toBeInTheDocument();
  });

  it("pads to two digits", () => {
    render(<HudTimer runningSinceMs={0} paused status="Standby" />);
    expect(screen.getByText(/^00\.00$/)).toBeInTheDocument();
  });

  it("drops the seconds suffix once there is a minutes part", () => {
    const { container, unmount } = render(
      <HudTimer runningSinceMs={12_340} paused status="Standby" />,
    );
    expect(container.querySelector(".timer-digits")?.textContent).toBe("12.34s");
    unmount();

    const over = render(<HudTimer runningSinceMs={63_450} paused status="Standby" />);
    expect(over.container.querySelector(".timer-digits")?.textContent).toBe("1:03.45");
  });

  it("switches to the full M:SS.hh format past a minute", () => {
    render(<HudTimer runningSinceMs={63_450} paused status="Standby" />);
    expect(screen.getByText("1:03.45")).toBeInTheDocument();
  });

  it("renders the status line", () => {
    render(<HudTimer runningSinceMs={0} paused status="On the Clock" />);
    expect(screen.getByText("On the Clock")).toBeInTheDocument();
  });

  it("holds the frozen time while paused", () => {
    // A paused clock must not interpolate; the number on screen is the number.
    vi.spyOn(performance, "now").mockReturnValue(1_000_000);
    render(<HudTimer runningSinceMs={5_000} paused status="Paused" />);
    expect(screen.getByText(/^05\.00$/)).toBeInTheDocument();
  });

  it("colours the digits as a warning while paused and as primary while running", () => {
    const { container, unmount } = render(<HudTimer runningSinceMs={0} paused status="Paused" />);
    expect(container.querySelector(".timer-digits")).toHaveClass("text-warn");
    unmount();

    const running = render(<HudTimer runningSinceMs={0} paused={false} status="Live" />);
    expect(running.container.querySelector(".timer-digits")).toHaveClass("text-primary");
  });

  it("sizes the ring from the size prop", () => {
    const { container } = render(
      <HudTimer runningSinceMs={0} paused status="Standby" size={340} />,
    );
    expect(container.firstElementChild).toHaveStyle({ width: "340px", height: "340px" });
    expect(container.querySelector("svg")).toHaveAttribute("viewBox", "0 0 340 340");
  });

  it("renders inner content when given children", () => {
    render(
      <HudTimer runningSinceMs={0} paused status="Standby">
        <span data-testid="silhouette" />
      </HudTimer>,
    );
    expect(screen.getByTestId("silhouette")).toBeInTheDocument();
  });

  it("wraps the progress arc within one target sweep", () => {
    // Two minutes against a one-minute target is one full lap plus a whole
    // second one, which must render as a full arc rather than overflowing.
    const { container } = render(
      <HudTimer runningSinceMs={120_000} paused status="Standby" targetMs={60_000} />,
    );
    const arc = container.querySelectorAll("circle")[1];
    expect(arc.getAttribute("stroke-dasharray")).toMatch(/^0 /);
  });

  it("stops animating once paused", () => {
    const raf = vi.spyOn(globalThis, "requestAnimationFrame");
    const { rerender } = render(<HudTimer runningSinceMs={0} paused={false} status="Live" />);
    raf.mockClear();
    rerender(<HudTimer runningSinceMs={1_000} paused status="Paused" />);
    expect(raf).not.toHaveBeenCalled();
  });
});
