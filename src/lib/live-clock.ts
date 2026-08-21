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
