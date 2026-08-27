/**
 * Whether a device can actually lean a card, and whether it will.
 *
 * `granted`     — orientation events are arriving.
 * `denied`      — the device can, the person said no.
 * `unsupported` — there is no gyroscope behind the API. Desktop Chrome and
 *                 Firefox both expose `DeviceOrientationEvent` and never fire
 *                 it, which is why feature-detecting the TYPE is not enough:
 *                 the chip lit, nothing moved, and nothing said why.
 */
export type GyroAccess = "granted" | "denied" | "unsupported";

/** How long to wait for a first reading before calling it no gyroscope. */
const FIRST_EVENT_TIMEOUT_MS = 600;

/**
 * Request access to device-orientation events.
 *
 * iOS 13+ gates `deviceorientation` behind an explicit permission prompt that
 * must be triggered by a user gesture — call this from a click handler, not on
 * mount. Every other browser either exposes the event freely or not at all, so
 * feature-detect rather than assuming the prompt exists.
 */
export async function requestGyroAccess(): Promise<GyroAccess> {
  if (typeof window === "undefined" || !("DeviceOrientationEvent" in window)) {
    return "unsupported";
  }
  const D = window.DeviceOrientationEvent as unknown as {
    requestPermission?: () => Promise<"granted" | "denied">;
  };
  if (typeof D.requestPermission === "function") {
    try {
      return (await D.requestPermission()) === "granted" ? "granted" : "denied";
    } catch {
      return "denied";
    }
  }
  // No prompt to answer, so the only honest test is whether a reading arrives.
  // A browser with no gyroscope behind the API stays silent forever.
  return new Promise<GyroAccess>((resolve) => {
    let settled = false;
    const done = (result: GyroAccess) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("deviceorientation", onReading);
      clearTimeout(timer);
      resolve(result);
    };
    const onReading = (e: DeviceOrientationEvent) => {
      // A device with no sensor can still fire one event with every angle null.
      if (e.beta == null && e.gamma == null && e.alpha == null) return;
      done("granted");
    };
    const timer = setTimeout(() => done("unsupported"), FIRST_EVENT_TIMEOUT_MS);
    window.addEventListener("deviceorientation", onReading);
  });
}
