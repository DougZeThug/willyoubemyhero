/**
 * The commissioner's console as the broadcast view sees it.
 *
 * /live mounts the timing controls so a run can be timed from the screen the
 * party is already watching, which means the page has to answer two questions
 * before it renders anything: is this device the commissioner's, and is there a
 * run in progress on it. Both answers are derived from state that lives
 * somewhere else -- the admin token in localStorage and the single active run
 * in IndexedDB -- so they are gathered here rather than inline, where they were
 * four branches of a component that already had too many.
 *
 * Spectators get `isAdmin: false` and a null run, and never see a control.
 */
import { useMemo } from "react";
import { useAdminSession } from "@/lib/admin-token";
import { useRunConsole } from "@/hooks/use-run-console";
import { computeElapsedMs } from "@/lib/active-run";

export function useLiveHud(eventId: string | null) {
  const admin = useAdminSession();
  const rc = useRunConsole();
  const isAdmin = eventId !== null && admin?.eventId === eventId;
  // A finished run is not being timed any more -- it is waiting for its result
  // to be saved -- so the ring goes back to the crowd's clock rather than
  // freezing on the last athlete's time.
  //
  // Nor is a run from another event. The console hydrates whatever IndexedDB
  // holds, deliberately unfiltered so the timing bar can still offer a leftover
  // run from last year's combine for Discard -- but the token matching THIS
  // event says nothing about that run, and the ring put it in front of the crowd
  // as if it were being timed now.
  const adminRun =
    isAdmin && rc.run && rc.run.eventId === eventId && rc.run.status !== "finished" ? rc.run : null;

  // While an admin is timing, the big ring shows the run they are actually
  // timing rather than the unofficial on-clock counter. Anchored on the run's
  // own stamps rather than recomputed each render: HudTimer restarts its
  // interpolation whenever runningSinceMs changes, so a fresh Date.now() every
  // render would re-anchor the clock on every bundle refetch.
  const runBaseMs = useMemo(
    () => (adminRun ? computeElapsedMs(adminRun, Date.now()) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [adminRun?.clientKey, adminRun?.status, adminRun?.startedAt, adminRun?.pauses.length],
  );

  // Read through adminRun rather than straight off the console: with no run
  // being timed here the ring belongs to the queue's own athlete, and the
  // console's selection is not that.
  const timedEp = adminRun ? (rc.currentEp ?? null) : null;

  return { isAdmin, adminRun, runBaseMs, timedEp, console: rc };
}
