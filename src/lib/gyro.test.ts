// Whether a device can actually lean a card, and whether it will.
//
// The old answer was a boolean that returned true whenever the orientation
// event TYPE existed but exposed no permission request — which is desktop
// Chrome and Firefox. The chip lit, nothing moved, and nothing said why.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestGyroAccess } from "./gyro";

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
