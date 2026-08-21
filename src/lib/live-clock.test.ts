import { describe, expect, it } from "vitest";
import { onClockElapsedMs } from "./live-clock";

const SINCE = "2026-07-28T12:00:00.000Z";
const START = Date.parse(SINCE);

describe("onClockElapsedMs", () => {
  it("measures from the stamp on the row", () => {
    expect(onClockElapsedMs({ on_clock_since: SINCE }, START + 20_000)).toBe(20_000);
  });

  it("is null when nobody is on the clock", () => {
    // Null rather than zero: the caller shows a stopped clock, not a running
    // one that happens to read 00.00.
    expect(onClockElapsedMs({ on_clock_since: null }, START)).toBeNull();
    expect(onClockElapsedMs({}, START)).toBeNull();
    expect(onClockElapsedMs(null, START)).toBeNull();
    expect(onClockElapsedMs(undefined, START)).toBeNull();
  });

  it("is null rather than NaN on a stamp it cannot read", () => {
    expect(onClockElapsedMs({ on_clock_since: "shortly" }, START)).toBeNull();
  });

  it("floors at zero when the phone's clock runs behind the server's", () => {
    expect(onClockElapsedMs({ on_clock_since: SINCE }, START - 5_000)).toBe(0);
  });

  it("reads zero at the instant of the stamp", () => {
    expect(onClockElapsedMs({ on_clock_since: SINCE }, START)).toBe(0);
  });
});
