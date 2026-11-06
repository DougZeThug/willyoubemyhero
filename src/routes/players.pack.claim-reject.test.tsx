// What the pack screen does when the server turns the member token away.
//
// The open effect's catch drops a token the server answers "Claim your player
// first" to, so the gate shows instead of a retry that can never work. But
// dropping the token flips the actor, the effect depends on the actor, and its
// latch key carries the actor — so a request left standing re-ran the effect
// past the latch and asked again as the guest, unasked. That second call can
// spend the day's pack on a guest deal.
//
// Its own file because it needs an actor that can change mid-test, and
// players.pack.test.tsx pins `useSecretActor` to one member for good.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { useSyncExternalStore, type ReactNode } from "react";
import PackPage from "./players.pack";
import { EVENT_ID, makeBundle } from "@/test/fixtures";

/**
 * Who the phone is, as one store every identity hook reads — so dropping the
 * token moves the actor and the pack identity in the same render, the way the
 * real hooks do.
 */
const who = vi.hoisted(() => {
  let member = true;
  const listeners = new Set<() => void>();
  return {
    isMember: () => member,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    dropMember() {
      member = false;
      for (const fn of listeners) fn();
    },
    reset() {
      member = true;
    },
  };
});

function useIsMember() {
  return useSyncExternalStore(who.subscribe, who.isMember, who.isMember);
}

const openPack = vi.hoisted(() => vi.fn());
const loadPackState = vi.hoisted(() => vi.fn());
const clearMemberToken = vi.hoisted(() => vi.fn(() => who.dropMember()));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    Link: (props: { to: string; children: ReactNode }) => <a href={props.to}>{props.children}</a>,
  };
});

vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined }),
  useQueryClient: () => ({
    setQueryData: vi.fn(),
    invalidateQueries: vi.fn(() => Promise.resolve()),
    getQueryData: vi.fn(),
  }),
}));

vi.mock("@/lib/pack.functions", () => ({ openPack }));

vi.mock("@/lib/member-token", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    clearMemberToken,
    useMemberSession: () =>
      useIsMember()
        ? { participantId: "me", expiresAt: Number.MAX_SAFE_INTEGER, token: "m.me.x.y", name: null }
        : null,
  };
});

vi.mock("@/hooks/use-daily-secret", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useSecretActor: () => (useIsMember() ? "m:me" : "g:guest"),
    useMySecrets: () => ({ data: undefined }),
  };
});

vi.mock("@/lib/device-id", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    deviceId: () => "device",
    usePackIdentity: () => (useIsMember() ? "m:me" : "d:device"),
  };
});

vi.mock("@/lib/card-collection", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, loadPackState, savePackState: vi.fn(() => Promise.resolve()) };
});

vi.mock("@/hooks/use-event-bundle", () => ({
  useEventBundle: () => ({
    event: { id: EVENT_ID, name: "Draft Combine", year: 2026, active: true },
    bundle: makeBundle(),
    loading: false,
    error: null,
    failedTables: [] as string[],
    realtimeDegraded: false,
    refetch: vi.fn(() => Promise.resolve()),
  }),
}));
vi.mock("@/hooks/use-my-collection", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useMyCollection: () => ({
      collection: {},
      collectedCount: 0,
      packsOpened: 0,
      dupes: 0,
      firstPackOn: null,
      ready: true,
      isMember: true,
      markCollected: vi.fn(),
    }),
  };
});
vi.mock("@/hooks/use-photo-urls", () => ({
  useEventCardUrls: () => ({ data: undefined }),
  useEventCardBack: () => ({ data: undefined }),
}));
vi.mock("@/hooks/use-guest-session", () => ({ useEnsureGuestSession: vi.fn() }));
vi.mock("@/hooks/use-pack-status", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, usePackStatus: () => ({ data: undefined }) };
});
vi.mock("@/hooks/use-streak", () => ({ useStreakStatus: () => ({ data: null }) }));
vi.mock("@/hooks/use-card-pulls", () => ({ useCardPullCounts: () => ({ data: undefined }) }));

beforeEach(async () => {
  who.reset();
  clearMemberToken.mockClear();
  openPack.mockReset().mockRejectedValue(new Error("Claim your player first."));
  // Today's pack, dealt to the member. The resume path finds it on mount and asks
  // the server for the cards — which is the request the server turns away.
  const { todayKey } =
    await vi.importActual<typeof import("@/lib/card-collection")>("@/lib/card-collection");
  loadPackState.mockReset().mockResolvedValue({
    dayKey: todayKey(),
    identity: "m:me",
    ids: ["ep-1"],
    cards: [{ kind: "roster", id: "ep-1" }],
    revealed: [],
    cursor: 0,
  });
});

describe("a member token the server turns away", () => {
  it("drops the token without asking again as the guest", async () => {
    render(<PackPage />);

    await waitFor(() => expect(clearMemberToken).toHaveBeenCalledTimes(1));
    // The identity flip re-runs the resume load for the guest, which finds the
    // member's row is not theirs. By then any re-fire would already have gone.
    await waitFor(() => expect(loadPackState).toHaveBeenCalledTimes(2));

    expect(openPack).toHaveBeenCalledTimes(1);
    // Re-sealed for the gate, not parked on a "No signal" retry that can only
    // be refused again.
    expect(screen.queryByTestId("pack-retry")).toBeNull();
  });
});

describe("the pack screen's recovery and hint chrome", () => {
  it("leaves the retry control undimmed, and dims only the dead-end slab", async () => {
    openPack.mockReset().mockRejectedValue(new Error("offline"));
    const { unmount } = render(<PackPage />);
    const retry = await screen.findByTestId("pack-retry");
    expect(retry.className).not.toContain("opacity-60");
    expect(retry.getAttribute("type")).toBe("button");
    unmount();

    openPack.mockReset().mockResolvedValue({ ok: false });
    render(<PackPage />);
    const slab = (await screen.findByText("Nothing to deal today")).parentElement!;
    expect(slab.className).toContain("opacity-60");
  });

  it("hides 'press Enter' on coarse pointers but keeps it in the text", async () => {
    loadPackState.mockReset().mockResolvedValue(null);
    render(<PackPage />);
    const hint = await screen.findByText("· or press Enter", { exact: false });
    expect(hint.className).toContain("pointer-coarse:hidden");
    expect(hint.parentElement!.textContent).toBe("Drag across the tear · or press Enter");
  });
});

describe("the dealing slot while the signal is slow", () => {
  const SLOW = /slow signal — it's yours either way/i;

  it("stays wordless until 3s, then says so politely, and drops it once the deal lands", async () => {
    vi.useFakeTimers();
    try {
      let land!: (v: { ok: false }) => void;
      openPack.mockReset().mockReturnValue(new Promise((r) => (land = r)));
      render(<PackPage />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      expect(screen.getByTestId("pack-dealing")).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_800);
      });
      expect(screen.queryByText(SLOW)).toBeNull();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      const line = screen.getByText(SLOW);
      expect(line).toHaveAttribute("role", "status");
      expect(screen.getByTestId("pack-dealing")).toContainElement(line);

      await act(async () => {
        land({ ok: false });
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.queryByText(SLOW)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("hands over to the retry card at the 8s timeout without keeping the line", async () => {
    vi.useFakeTimers();
    try {
      openPack.mockReset().mockReturnValue(new Promise(() => {}));
      render(<PackPage />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      expect(screen.getByTestId("pack-dealing")).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_400);
      });
      expect(screen.getByText(SLOW)).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      expect(screen.getByTestId("pack-retry")).toBeInTheDocument();
      expect(screen.queryByText(SLOW)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
