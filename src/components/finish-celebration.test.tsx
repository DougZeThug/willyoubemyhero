// The celebration mounts once on /live and stays mounted for the whole
// combine, so the failure modes worth pinning are all about the second
// finisher and the re-renders between finishes — not the first happy path.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { FinishCelebration } from "./finish-celebration";

vi.mock("canvas-confetti", () => ({ default: vi.fn() }));

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("FinishCelebration", () => {
  it("shows the finisher and auto-dismisses after the hold", () => {
    const onDone = vi.fn();
    render(<FinishCelebration name="AJ" timeMs={60_810} deltaMs={0} onDone={onDone} />);
    expect(screen.getByText("AJ")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(4_200));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("celebrates the second finisher too, timer and all", () => {
    // The old one-shot latch fired once per session: finishers two through
    // thirteen got a blocking overlay with no confetti and no auto-dismiss.
    const onDone = vi.fn();
    const { rerender } = render(
      <FinishCelebration name="AJ" timeMs={60_810} deltaMs={0} onDone={onDone} />,
    );
    act(() => vi.advanceTimersByTime(4_200));
    expect(onDone).toHaveBeenCalledTimes(1);

    // /live clears the payload on dismiss, then the next finish arrives.
    rerender(<FinishCelebration name={null} timeMs={null} deltaMs={null} onDone={onDone} />);
    rerender(<FinishCelebration name="Doug" timeMs={66_410} deltaMs={5_600} onDone={onDone} />);
    expect(screen.getByText("Doug")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(4_200));
    expect(onDone).toHaveBeenCalledTimes(2);
  });

  it("keeps one auto-dismiss timer across parent re-renders", () => {
    // /live hands down a fresh inline onDone every render, and the bundle
    // re-fetches on realtime — so re-renders mid-celebration are the normal
    // case. A new callback identity must neither reset the timer nor re-fire.
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(
      <FinishCelebration name="AJ" timeMs={60_810} deltaMs={0} onDone={first} />,
    );
    act(() => vi.advanceTimersByTime(2_000));
    rerender(<FinishCelebration name="AJ" timeMs={60_810} deltaMs={0} onDone={second} />);
    // 4.2s from the finish, not from the re-render — and the latest callback wins.
    act(() => vi.advanceTimersByTime(2_200));
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it("hands the timer to a finisher who lands mid-celebration", () => {
    // Back-to-back runs: the new payload replaces the old with no null gap
    // in between. The new finisher gets their own full hold.
    const onDone = vi.fn();
    const { rerender } = render(
      <FinishCelebration name="AJ" timeMs={60_810} deltaMs={0} onDone={onDone} />,
    );
    act(() => vi.advanceTimersByTime(3_000));
    rerender(<FinishCelebration name="Doug" timeMs={66_410} deltaMs={5_600} onDone={onDone} />);
    act(() => vi.advanceTimersByTime(1_300));
    // AJ's timer would have fired by now; Doug's must not have.
    expect(onDone).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(2_900));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("takes focus, keeps Tab inside, and gives it back once the athlete clears", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const { rerender } = render(
      <FinishCelebration name="AJ" timeMs={60_810} deltaMs={0} onDone={vi.fn()} />,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(dialog);
    rerender(<FinishCelebration name={null} timeMs={null} deltaMs={null} onDone={vi.fn()} />);
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it("renders nothing between finishes", () => {
    render(<FinishCelebration name={null} timeMs={null} deltaMs={null} onDone={vi.fn()} />);
    expect(screen.queryByText("Finish")).toBeNull();
  });
});
