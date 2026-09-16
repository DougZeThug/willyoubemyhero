// Thirteen share buttons, one offscreen card between them.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import LeaderboardPage from "./leaderboard";
import { EVENT_ID, makeBundle, makeParticipant, makeRun, resetFixtureIds } from "@/test/fixtures";

const useEventBundle = vi.fn();
const exportCardPng = vi.fn();

vi.mock("@/hooks/use-event-bundle", () => ({
  useEventBundle: (...args: unknown[]) => useEventBundle(...args),
}));

vi.mock("@/hooks/use-photo-urls", () => ({
  useEventPhotoUrls: () => ({ data: {} }),
  useEventCardUrls: () => ({ data: {} }),
}));

vi.mock("@/lib/share-card", () => ({
  exportCardPng: (...args: unknown[]) => exportCardPng(...args),
  waitForPaint: vi.fn(async () => {}),
}));

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

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

function twoFinishers() {
  const alice = makeParticipant({
    participation_status: "finished",
    participant: { id: "p-a", name: "Alice Ace", nickname: null },
  });
  const bob = makeParticipant({
    participation_status: "finished",
    participant: { id: "p-b", name: "Bob Bison", nickname: null },
  });
  useEventBundle.mockReturnValue({
    event: { id: EVENT_ID, name: "Draft Combine", year: 2026, active: true },
    bundle: makeBundle({
      participants: [alice, bob],
      runs: [
        makeRun({ participant_id: alice.participant_id, official_time_ms: 50_000 }),
        makeRun({ participant_id: bob.participant_id, official_time_ms: 60_000 }),
      ],
    }),
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
  exportCardPng.mockReset();
});

describe("LeaderboardPage sharing", () => {
  it("disables every share button while one export is in flight", async () => {
    // Only the clicked row used to go inert, so a second tap repointed the one
    // offscreen ResultCard mid-export and A's PNG rasterised B — the wrong
    // athlete, under the right filename, straight into the group chat.
    twoFinishers();
    exportCardPng.mockReturnValue(new Promise(() => {}));

    render(<LeaderboardPage />);
    const buttons = screen.getAllByRole("button", { name: /share .* result card/i });
    expect(buttons).toHaveLength(2);

    await userEvent.click(buttons[0]);

    await waitFor(() => {
      for (const b of screen.getAllByRole("button", { name: /share .* result card/i })) {
        expect(b).toBeDisabled();
      }
    });
  });

  it("hands the buttons back once the export settles", async () => {
    twoFinishers();
    exportCardPng.mockResolvedValue(undefined);

    render(<LeaderboardPage />);
    const buttons = screen.getAllByRole("button", { name: /share .* result card/i });
    await userEvent.click(buttons[0]);

    await waitFor(() => {
      for (const b of screen.getAllByRole("button", { name: /share .* result card/i })) {
        expect(b).toBeEnabled();
      }
    });
    expect(exportCardPng).toHaveBeenCalledTimes(1);
  });
});
