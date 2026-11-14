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

  it("shows an 's' suffix under a minute and drops it once there is a minutes part", () => {
    const { unmount } = render(<HudTimer runningSinceMs={12_340} paused status="Standby" />);
    expect(screen.getByText("12.34")).toBeInTheDocument();
    expect(screen.getByText("s")).toBeInTheDocument();
    unmount();

    render(<HudTimer runningSinceMs={63_450} paused status="Standby" />);
    expect(screen.getByText("1:03.45")).toBeInTheDocument();
    expect(screen.queryByText("s")).not.toBeInTheDocument();
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
    const { unmount } = render(<HudTimer runningSinceMs={0} paused status="Paused" />);
    expect(screen.getByText("00.00")).toHaveClass("text-warn");
    unmount();

    vi.spyOn(performance, "now").mockReturnValue(0);
    render(<HudTimer runningSinceMs={0} paused={false} status="Live" />);
    expect(screen.getByText(/^00\.0\d$/)).toHaveClass("text-primary");
  });

  it("sizes the ring from the size prop", () => {
    const { container } = render(
      <HudTimer runningSinceMs={0} paused status="Standby" size={340} />,
    );
    expect(container.firstElementChild).toHaveStyle({ width: "340px", height: "340px" });
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
    const arc = container.querySelector('[data-testid="hud-arc"]');
    expect(arc?.getAttribute("stroke-dasharray")).toMatch(/^0 /);
  });

  it("stops animating once paused", () => {
    const raf = vi.spyOn(globalThis, "requestAnimationFrame");
    const { rerender } = render(<HudTimer runningSinceMs={0} paused={false} status="Live" />);
    raf.mockClear();
    rerender(<HudTimer runningSinceMs={1_000} paused status="Paused" />);
    expect(raf).not.toHaveBeenCalled();
  });
});
