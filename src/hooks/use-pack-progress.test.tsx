// Reading today's pack from a screen that is not the pack.
//
// Every case here is a way the vault could end up lying about the pack: saying
// sealed over a half-open one, saying torn on somebody else's, or never leaving
// "loading" at all. The state machine itself is pinned in pack.test.ts; this
// covers the wiring — IndexedDB, the identity, the day tick and the two events.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { resetIndexedDB } from "@/test/idb";
import { PACK_DEALT_KEY, PACK_STATE_CHANGED, todayKey } from "@/lib/card-collection";

const DEVICE = "test-device";

async function seed(row: Record<string, unknown>) {
  const { savePackState } = await import("@/lib/card-collection");
  await savePackState(row as never);
}

async function mountHook(secretOwed = false) {
  const { usePackProgress } = await import("./use-pack-progress");
  return renderHook(() => usePackProgress(secretOwed));
}

beforeEach(() => {
  vi.resetModules();
  resetIndexedDB();
  // A device rather than a member, so the identity is `d:<id>` and settles from
  // localStorage on the hook's first effect.
  window.localStorage.setItem("wwbh:device-id", DEVICE);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("usePackProgress", () => {
  it("says it does not know on the very first frame", async () => {
    // The honest answer before IndexedDB has spoken. SSR has no IndexedDB at
    // all, and the read is a tick behind mount on every client — so a hook that
    // guessed "sealed" here would paint "Open today's pack" over a pack somebody
    // is halfway through, then swap the label under their thumb.
    await seed({
      dayKey: todayKey(),
      ids: ["a", "b", "c"],
      revealed: [0],
      cursor: 1,
      identity: `d:${DEVICE}`,
    });
    const { result } = await mountHook();
    expect(result.current.state).toBe("loading");
    await waitFor(() => expect(result.current.state).toBe("torn"));
  });

  it("is sealed on a device that has not opened one today", async () => {
    const { result } = await mountHook();
    await waitFor(() => expect(result.current.state).toBe("sealed"));
    expect(result.current.left).toBe(0);
  });

  it("is torn, with a count, while cards are still face-down", async () => {
    await seed({
      dayKey: todayKey(),
      ids: ["a", "b", "c"],
      revealed: [0],
      cursor: 1,
      identity: `d:${DEVICE}`,
    });
    const { result } = await mountHook();
    await waitFor(() => expect(result.current.state).toBe("torn"));
    expect(result.current.left).toBe(2);
  });

  it("counts the secret's slot when one is waiting", async () => {
    await seed({
      dayKey: todayKey(),
      ids: ["a", "b", "c"],
      revealed: [0, 1, 2],
      cursor: 3,
      identity: `d:${DEVICE}`,
    });
    const { result } = await mountHook(true);
    await waitFor(() => expect(result.current.state).toBe("torn"));
    expect(result.current.left).toBe(1);
  });

  it("is done once the whole pack is turned", async () => {
    await seed({
      dayKey: todayKey(),
      ids: ["a", "b", "c"],
      revealed: [0, 1, 2],
      cursor: 3,
      secretRevealed: true,
      identity: `d:${DEVICE}`,
    });
    const { result } = await mountHook();
    await waitFor(() => expect(result.current.state).toBe("done"));
  });

  it("calls yesterday's row sealed rather than resuming it", async () => {
    await seed({
      dayKey: "2001-01-01",
      ids: ["a", "b", "c"],
      revealed: [0],
      cursor: 1,
      identity: `d:${DEVICE}`,
    });
    const { result } = await mountHook();
    await waitFor(() => expect(result.current.state).toBe("sealed"));
  });

  it("does not resume the pack of whoever held the phone before", async () => {
    await seed({
      dayKey: todayKey(),
      ids: ["a", "b", "c"],
      revealed: [0],
      cursor: 1,
      identity: "m:somebody-else",
    });
    const { result } = await mountHook();
    await waitFor(() => expect(result.current.state).toBe("sealed"));
  });

  it("re-reads when the pack is torn behind it", async () => {
    // The vault left open behind the pack screen. IndexedDB fires nothing, so
    // the route's own event is the only thing that carries a tear back here.
    const { result } = await mountHook();
    await waitFor(() => expect(result.current.state).toBe("sealed"));
    await seed({
      dayKey: todayKey(),
      ids: ["a", "b", "c"],
      revealed: [],
      cursor: 0,
      identity: `d:${DEVICE}`,
    });
    act(() => {
      window.dispatchEvent(new Event(PACK_STATE_CHANGED));
    });
    await waitFor(() => expect(result.current.state).toBe("torn"));
    expect(result.current.left).toBe(3);
  });

  it("re-reads when another tab tears one", async () => {
    // IndexedDB fires no cross-tab event either; the localStorage mirror does.
    const { result } = await mountHook();
    await waitFor(() => expect(result.current.state).toBe("sealed"));
    await seed({
      dayKey: todayKey(),
      ids: ["a", "b"],
      revealed: [],
      cursor: 0,
      identity: `d:${DEVICE}`,
    });
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: PACK_DEALT_KEY }));
    });
    await waitFor(() => expect(result.current.state).toBe("torn"));
  });

  it("re-seals when the day turns under a tab left open overnight", async () => {
    // Polled rather than scheduled, for the reason the pack screen gives: a
    // phone suspends timers, and the timer that mattered was always set for
    // exactly the moment the screen was off.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const today = todayKey();
    await seed({
      dayKey: today,
      ids: ["a", "b", "c"],
      revealed: [0],
      cursor: 1,
      identity: `d:${DEVICE}`,
    });
    const { result } = await mountHook();
    await waitFor(() => expect(result.current.state).toBe("torn"));

    // Midnight, as far as the device is concerned.
    vi.setSystemTime(new Date(Date.now() + 36 * 3_600_000));
    await act(async () => {
      vi.advanceTimersByTime(61_000);
    });
    await waitFor(() => expect(result.current.state).toBe("sealed"));
  });

  it("re-reads the row when the tab comes back into view", async () => {
    // The two events above cover a tear and nothing after it: PACK_STATE_CHANGED
    // is same-window, and the localStorage mirror is written once per pack by
    // design. Without this, a vault left open beside the pack shows the count it
    // had when the pack was torn for the rest of the day.
    await seed({
      dayKey: todayKey(),
      ids: ["a", "b", "c"],
      revealed: [0],
      cursor: 1,
      identity: `d:${DEVICE}`,
    });
    const { result } = await mountHook();
    await waitFor(() => expect(result.current.left).toBe(2));

    // The other tab keeps going. IndexedDB fires nothing; the mirror does not
    // move; nothing tells this tab at all.
    await seed({
      dayKey: todayKey(),
      ids: ["a", "b", "c"],
      revealed: [0, 1, 2],
      cursor: 3,
      identity: `d:${DEVICE}`,
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(result.current.state).toBe("done"));
  });

  it("ignores a storage event about something else entirely", async () => {
    const { result } = await mountHook();
    await waitFor(() => expect(result.current.state).toBe("sealed"));
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "wwbh:sfx-muted" }));
    });
    expect(result.current.state).toBe("sealed");
  });
});
