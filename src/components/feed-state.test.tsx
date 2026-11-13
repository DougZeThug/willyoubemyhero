// The three states the spectator screens used to render identically.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  FeedDegradedBanner,
  FeedError,
  FeedLoading,
  feedReadError,
  readFailedMessage,
} from "./feed-state";

describe("FeedLoading", () => {
  it("says it is still reading, not that there is nothing there", () => {
    render(<FeedLoading />);
    expect(screen.getByText("Reading the combine…")).toBeInTheDocument();
  });

  it("takes a screen-specific label", () => {
    render(<FeedLoading label="Reading the draft board…" />);
    expect(screen.getByText("Reading the draft board…")).toBeInTheDocument();
  });
});

describe("FeedError", () => {
  it("shows the reason the fetch failed", () => {
    render(<FeedError message="offline" />);
    expect(screen.getByText("Can't reach the combine")).toBeInTheDocument();
    expect(screen.getByText("offline")).toBeInTheDocument();
  });

  it("reassures without a reason to show", () => {
    render(<FeedError />);
    expect(screen.getByText(/read-only/)).toBeInTheDocument();
  });

  it("offers a retry only when there is something to retry with", () => {
    const onRetry = vi.fn();
    const { rerender } = render(<FeedError message="offline" />);
    expect(screen.queryByRole("button", { name: /try again/i })).toBeNull();
    rerender(<FeedError message="offline" onRetry={onRetry} />);
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("retries when tapped", async () => {
    const onRetry = vi.fn();
    render(<FeedError message="offline" onRetry={onRetry} />);
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("FeedDegradedBanner", () => {
  it("frames a dead socket as a delay, because the numbers are still real", () => {
    render(<FeedDegradedBanner />);
    expect(screen.getByText(/refreshing every few seconds/i)).toBeInTheDocument();
  });
});

describe("feedReadError", () => {
  it("is all clear on a healthy read", () => {
    expect(feedReadError([])).toEqual({ runs: false, roster: false, splits: false });
  });

  it("names the roster apart from the runs", () => {
    expect(feedReadError(["event_participants"])).toMatchObject({ roster: true, runs: false });
    expect(feedReadError(["runs"])).toMatchObject({ roster: false, runs: true });
  });

  it("counts a failed stations read as a failed splits read, and ignores other tables", () => {
    expect(feedReadError(["stations"]).splits).toBe(true);
    expect(feedReadError(["splits"]).splits).toBe(true);
    expect(feedReadError(["penalties", "drafts"])).toEqual({
      runs: false,
      roster: false,
      splits: false,
    });
  });

  it("words every failure the same way", () => {
    expect(readFailedMessage("roster")).toBe("Couldn't read the roster just now — retrying.");
  });
});
