// Whether a device can actually lean a card, and whether it will.
//
// The old answer was a boolean that returned true whenever the orientation
// event TYPE existed but exposed no permission request — which is desktop
// Chrome and Firefox. The chip lit, nothing moved, and nothing said why.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { hasLiveGyro, isTiltWanted, requestGyroAccess, setTiltWanted, useTiltWanted } from "./gyro";

const original = Object.getOwnPropertyDescriptor(window, "DeviceOrientationEvent");

function withOrientation(requestPermission?: () => Promise<"granted" | "denied">) {
  const D = function () {} as unknown as { requestPermission?: unknown };
  if (requestPermission) D.requestPermission = requestPermission;
  Object.defineProperty(window, "DeviceOrientationEvent", { value: D, configurable: true });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  if (original) Object.defineProperty(window, "DeviceOrientationEvent", original);
  else
    Reflect.deleteProperty(window as unknown as Record<string, unknown>, "DeviceOrientationEvent");
});

describe("requestGyroAccess", () => {
  it("is unsupported when the event type does not exist", async () => {
    Reflect.deleteProperty(window as unknown as Record<string, unknown>, "DeviceOrientationEvent");
    await expect(requestGyroAccess()).resolves.toBe("unsupported");
  });

  it("honours the iOS permission prompt", async () => {
    withOrientation(async () => "granted");
    await expect(requestGyroAccess()).resolves.toBe("granted");
  });

  it("reports a refusal as denied, not as no hardware", async () => {
    withOrientation(async () => "denied");
    await expect(requestGyroAccess()).resolves.toBe("denied");
  });

  it("reports a browser that never fires a reading as unsupported", async () => {
    // Desktop Chrome and Firefox both land here: the API exists, no prompt
    // exists, and no event ever arrives.
    withOrientation();
    const pending = requestGyroAccess();
    await vi.advanceTimersByTimeAsync(700);
    await expect(pending).resolves.toBe("unsupported");
  });

  it("is granted once a real reading arrives", async () => {
    withOrientation();
    const pending = requestGyroAccess();
    const event = new Event("deviceorientation") as Event & { beta: number | null };
    Object.defineProperty(event, "beta", { value: 12 });
    window.dispatchEvent(event);
    await expect(pending).resolves.toBe("granted");
  });

  it("ignores a reading with no angles in it", async () => {
    // A device with no sensor can still fire one event with every angle null.
    withOrientation();
    const pending = requestGyroAccess();
    window.dispatchEvent(new Event("deviceorientation"));
    await vi.advanceTimersByTimeAsync(700);
    await expect(pending).resolves.toBe("unsupported");
  });
});

describe("hasLiveGyro", () => {
  // The question a stored preference cannot answer. A grant does not outlive a
  // browsing session on iOS and there is no way to query one, so a remembered
  // "tilt wanted" restored straight into an active tilt is a chip lit over a
  // card that never moves — which is the failure the top of gyro.ts describes.

  it("is false when the event type does not exist at all", async () => {
    Reflect.deleteProperty(window as unknown as Record<string, unknown>, "DeviceOrientationEvent");
    await expect(hasLiveGyro()).resolves.toBe(false);
  });

  it("is true while readings are actually arriving", async () => {
    withOrientation(async () => "granted");
    const pending = hasLiveGyro();
    const event = new Event("deviceorientation") as Event & { beta: number | null };
    Object.defineProperty(event, "beta", { value: 12 });
    window.dispatchEvent(event);
    await expect(pending).resolves.toBe(true);
  });

  it("is false when the grant has lapsed and nothing fires", async () => {
    withOrientation(async () => "granted");
    const pending = hasLiveGyro();
    await vi.advanceTimersByTimeAsync(700);
    await expect(pending).resolves.toBe(false);
  });

  it("never asks for permission — a page nobody tapped is not a question", async () => {
    // A prompt outside a user gesture is refused anyway, and iOS is the only
    // platform that has one. The card's own chip is still there to ask from a tap.
    const requestPermission = vi.fn(async () => "granted" as const);
    withOrientation(requestPermission);
    const pending = hasLiveGyro();
    await vi.advanceTimersByTimeAsync(700);
    await expect(pending).resolves.toBe(false);
    expect(requestPermission).not.toHaveBeenCalled();
  });
});

describe("the tilt preference", () => {
  // Real timers: the store has none, and the fake ones above make the effect in
  // useTiltWanted a thing that has to be pumped rather than one that just runs.
  beforeEach(() => {
    vi.useRealTimers();
    setTiltWanted(false);
  });

  it("is remembered, so a card leans on the next page too", () => {
    // The whole reason it exists: the grant used to be useState on the player
    // page, so tilt turned itself off on every navigation.
    setTiltWanted(true);
    expect(isTiltWanted()).toBe(true);
    expect(localStorage.getItem("wwbh:tilt")).toBe("1");
  });

  it("starts flat and picks the preference up in an effect", () => {
    // Never during render: SSR has no localStorage, and a first paint that
    // disagreed with the server is the bug use-photo-urls.ts is written around.
    localStorage.setItem("wwbh:tilt", "1");
    const { result } = renderHook(() => useTiltWanted());
    expect(result.current).toBe(true);
  });

  it("follows the switch without a reload", () => {
    // Two surfaces set this — /you and the player page's own chip — and a
    // `storage` event only fires in OTHER tabs, which is what the custom event
    // below is for.
    const { result } = renderHook(() => useTiltWanted());
    expect(result.current).toBe(false);
    act(() => setTiltWanted(true));
    expect(result.current).toBe(true);
  });

  it("holds for this page load even when storage is refused", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    setTiltWanted(true);
    expect(isTiltWanted()).toBe(true);
    setItem.mockRestore();
  });
});
