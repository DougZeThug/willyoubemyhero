// The wake lock is a nicety with sharp edges: browsers drop it silently when
// the tab hides, the API is missing on older phones, and a lock acquired after
// its effect tore down would burn the screen forever. Each of those is a case.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useWakeLock } from "./use-wake-lock";

type Sentinel = { release: ReturnType<typeof vi.fn> };

function stubWakeLock() {
  const sentinels: Sentinel[] = [];
  let pending: ((s: WakeLockSentinel) => void) | null = null;
  const request = vi.fn(() => {
    return new Promise<WakeLockSentinel>((resolve) => {
      pending = resolve;
    });
  });
  const grant = async () => {
    const s: Sentinel = { release: vi.fn(async () => {}) };
    sentinels.push(s);
    pending?.(s as unknown as WakeLockSentinel);
    pending = null;
    // Let the awaiting acquire() observe the resolution.
    await act(async () => {});
    return s;
  };
  Object.defineProperty(navigator, "wakeLock", {
    configurable: true,
    value: { request },
  });
  return { request, grant, sentinels };
}

afterEach(() => {
  delete (navigator as { wakeLock?: unknown }).wakeLock;
  vi.restoreAllMocks();
});

describe("useWakeLock", () => {
  it("requests a screen lock while active and releases it when done", async () => {
    const lock = stubWakeLock();
    const { rerender } = renderHook(({ on }) => useWakeLock(on), {
      initialProps: { on: true },
    });
    expect(lock.request).toHaveBeenCalledWith("screen");
    const s = await lock.grant();

    rerender({ on: false });
    await act(async () => {});
    expect(s.release).toHaveBeenCalled();
  });

  it("asks nothing of a browser without the API", () => {
    // No stub installed: the hook must simply do nothing rather than throw —
    // this is every older phone at the party.
    expect(() => renderHook(() => useWakeLock(true))).not.toThrow();
  });

  it("takes the lock back when the tab returns", async () => {
    const lock = stubWakeLock();
    renderHook(() => useWakeLock(true));
    await lock.grant();
    expect(lock.request).toHaveBeenCalledTimes(1);

    // The browser dropped the lock on hide; the return is what re-acquires.
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(lock.request).toHaveBeenCalledTimes(2);
  });

  it("releases a lock that lands after the effect tore down", async () => {
    // The request is async: finishing a run mid-flight must not strand a lock
    // nothing will ever release.
    const lock = stubWakeLock();
    const { rerender } = renderHook(({ on }) => useWakeLock(on), {
      initialProps: { on: true },
    });
    rerender({ on: false });
    const s = await lock.grant();
    expect(s.release).toHaveBeenCalled();
  });
});
