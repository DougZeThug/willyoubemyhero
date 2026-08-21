// The save that ends a run, extracted from the timing console.
//
// It lives here because a failed save used to be unrecoverable: the console
// flipped the run to `finished` before the network call, and the finished
// branch hid every control, so a save that threw left an unreachable run
// sitting in IndexedDB with no way to retry it and no way to clear it.
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { saveCompletedRun } from "@/lib/admin-write.functions";
import { computeElapsedMs, type ActiveRun } from "@/lib/active-run";

export type FinishSaveState = "idle" | "saving" | "failed";

/** A run that has stopped: it carries the finish anchors a retry re-sends. */
export type FinishedRun = ActiveRun & {
  status: "finished";
  finishedAt: number;
  finishedAtIso: string;
};

export function asFinishedRun(run: ActiveRun | null | undefined): FinishedRun | null {
  return run && run.status === "finished" && run.finishedAt != null && run.finishedAtIso != null
    ? (run as FinishedRun)
    : null;
}

/**
 * Everything here comes off the stored record, never off the clock. A retry
 * five minutes later has to send the same time as the first attempt, or the
 * second upsert of that client_key silently rewrites the official time.
 */
export function buildFinishPayload(run: FinishedRun, eventId: string) {
  return {
    eventId,
    participantId: run.participantId,
    clientKey: run.clientKey,
    started_at: run.startedAtIso,
    finished_at: run.finishedAtIso,
    raw_time_ms: computeElapsedMs(run, run.finishedAt),
    paused_duration_ms: Math.round(
      run.pauses.reduce((s, p) => s + ((p.resumedAt ?? run.finishedAt) - p.pausedAt), 0),
    ),
    splits: run.splits.map((s) => ({
      stationId: s.stationId,
      cumulative_time_ms: s.cumulative_time_ms,
      segment_time_ms: s.segment_time_ms,
      clientKey: s.clientKey,
      recorded_at: s.recorded_at,
    })),
    penalties: run.penalties.map((p) => ({
      stationId: p.stationId,
      penalty_ms: p.penalty_ms,
      reason: p.reason,
      clientKey: p.clientKey,
    })),
  };
}

export function useFinishSave({
  eventId,
  onSaved,
}: {
  eventId: string | null | undefined;
  onSaved: () => void | Promise<void>;
}) {
  const saveRunFn = useServerFn(saveCompletedRun);
  const [state, setState] = useState<FinishSaveState>("idle");
  const [error, setError] = useState<string | null>(null);

  // A double tap fires two handlers off the same render, both holding the
  // pre-finish run. They'd upsert the same client_key with different stop
  // times and the second one would silently become the official time.
  const inFlight = useRef(false);

  // Held in a ref so `save` stays stable across renders; the console rebuilds
  // this callback every time the run changes.
  const savedCb = useRef(onSaved);
  useEffect(() => {
    savedCb.current = onSaved;
  });

  const save = useCallback(
    async (run: FinishedRun) => {
      if (!eventId || inFlight.current) return;
      inFlight.current = true;
      setState("saving");
      setError(null);
      let stored = false;
      try {
        await saveRunFn({ data: buildFinishPayload(run, eventId) });
        stored = true;
      } catch (e) {
        setState("failed");
        setError(e instanceof Error ? e.message : "Could not reach the server");
      } finally {
        inFlight.current = false;
      }
      // Outside the catch on purpose: the row is written by this point, so a
      // throw from the caller's cleanup must not report the run as unsaved.
      if (stored) {
        setState("idle");
        await savedCb.current();
      }
    },
    [eventId, saveRunFn],
  );

  const reset = useCallback(() => {
    setState("idle");
    setError(null);
  }, []);

  return { state, error, save, reset };
}
