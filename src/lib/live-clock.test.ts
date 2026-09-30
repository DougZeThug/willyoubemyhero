import { describe, expect, it } from "vitest";
import { hudStatus, onClockElapsedMs } from "./live-clock";

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

describe("hudStatus", () => {
  const idle = { timingStatus: null, onClock: false, hasCurrent: false, loading: false } as const;

  it("shows the run this device is timing, running or paused", () => {
    expect(hudStatus({ ...idle, timingStatus: "running" })).toBe("running");
    expect(hudStatus({ ...idle, timingStatus: "paused" })).toBe("paused");
  });

  it("lets the timed run outrank the crowd's clock", () => {
    // The ring follows the run being measured, not the unofficial counter that
    // started when the commissioner put somebody on the clock. Both are true at
    // once for most of a run, and they are not the same number.
    expect(hudStatus({ ...idle, timingStatus: "running", onClock: true })).toBe("running");
    expect(hudStatus({ ...idle, timingStatus: "paused", onClock: true, hasCurrent: true })).toBe(
      "paused",
    );
  });

  it("falls back to the clock, then the queue", () => {
    expect(hudStatus({ ...idle, onClock: true, hasCurrent: true })).toBe("on-clock");
    expect(hudStatus({ ...idle, hasCurrent: true })).toBe("up-next");
  });

  it("only says Loading before the first fetch has landed", () => {
    // An empty field that has finished loading is Standby. Saying Loading there
    // is the same lie the empty-state copy used to tell.
    expect(hudStatus({ ...idle, loading: true })).toBe("loading");
    expect(hudStatus(idle)).toBe("standby");
    expect(hudStatus({ ...idle, hasCurrent: true, loading: true })).toBe("up-next");
  });
});
