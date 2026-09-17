/**
 * The crowd's clock.
 *
 * Unofficial by construction, and labelled that way on screen. `on_clock_since`
 * is stamped when the commissioner puts somebody on the clock, which usually
 * happens a beat before they tap Start — so this reads a little ahead of the
 * time that ends up in the record. The official time is measured by the timing
 * console and written to runs.raw_time_ms; this only exists so the big screen
 * counts up from something real instead of from whenever the browser loaded.
 */
import type { ActiveRun } from "./active-run";

export type OnClockEntry = { on_clock_since?: string | null };

export function onClockElapsedMs(
  ep: OnClockEntry | null | undefined,
  nowMs: number,
): number | null {
  const since = ep?.on_clock_since;
  if (!since) return null;
  const startedAt = Date.parse(since);
  if (Number.isNaN(startedAt)) return null;
  // A phone whose clock runs behind the server's would otherwise render a
  // negative time; zero is the honest floor.
  return Math.max(0, nowMs - startedAt);
}

/**
 * What the big ring is doing, as a discriminant rather than as copy.
 *
 * Separated from its wording the same way `idleFieldState` is: the six outcomes
 * are a decision about the field, the strings beside them are a decision about
 * the screen, and only the first one is worth pinning in a test.
 *
 * The order is the whole rule. A commissioner timing a run on this device
 * outranks everything else, because that run is the one being measured -- the
 * on-clock counter above it is the crowd's unofficial clock and says so. Below
 * that, somebody on the clock outranks somebody merely next, and "Loading"
 * only ever shows before the first fetch has landed: once the roster is known
 * and nobody is in it, the honest word is Standby.
 */
export type HudStatus = "running" | "paused" | "on-clock" | "up-next" | "loading" | "standby";

export function hudStatus(state: {
  /** The run this device is timing, if any. Null when nobody is timing here. */
  timingStatus: ActiveRun["status"] | null;
  onClock: boolean;
  hasCurrent: boolean;
  loading: boolean;
}): HudStatus {
  if (state.timingStatus) return state.timingStatus === "running" ? "running" : "paused";
  if (state.onClock) return "on-clock";
  if (state.hasCurrent) return "up-next";
  return state.loading ? "loading" : "standby";
}
