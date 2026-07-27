/**
 * Request access to device-orientation events.
 *
 * iOS 13+ gates `deviceorientation` behind an explicit permission prompt that
 * must be triggered by a user gesture — call this from a click handler, not on
 * mount. Every other browser either exposes the event freely or not at all, so
 * feature-detect rather than assuming the prompt exists.
 */
export async function requestGyroPermission(): Promise<boolean> {
  if (typeof window === "undefined" || !("DeviceOrientationEvent" in window)) return false;
  const D = window.DeviceOrientationEvent as unknown as {
    requestPermission?: () => Promise<"granted" | "denied">;
  };
  if (typeof D.requestPermission !== "function") return true;
  try {
    return (await D.requestPermission()) === "granted";
  } catch {
    return false;
  }
}
