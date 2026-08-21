// Stopping a run and getting it to the league.
//
// It lives here because a failed save used to be unrecoverable: the console
// flipped the run to `finished` before the network call, and the finished
// branch hid every control, so a save that threw left an unreachable run
// sitting in IndexedDB with no way to retry it and no way to clear it.
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { saveCompletedRun } from "@/lib/admin-write.functions";
import { computeElapsedMs, saveActiveRun, type ActiveRun } from "@/lib/active-run";

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
 * Everything here comes off the stored record, never off the clock or off the
 * page. A retry five minutes later has to send the same time as the first
 * attempt, or the second upsert of that client_key silently rewrites the
 * official time — and it has to reach the event the athlete actually ran at,
 * not whichever one happens to be active when the retry is tapped.
 */
export function buildFinishPayload(run: FinishedRun) {
  return {
    eventId: run.eventId,
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
  onDraft,
  onSaved,
}: {
  /** Hand the stopped record back to the console before it goes anywhere. */
  onDraft: (run: FinishedRun) => void;
  onSaved: () => void | Promise<void>;
}) {
  const saveRunFn = useServerFn(saveCompletedRun);
  const [state, setState] = useState<FinishSaveState>("idle");
  const [error, setError] = useState<string | null>(null);

  // Synchronous, because React state is not. Two Finish taps in one tick both
  // hold the pre-finish run: without this they stamp two different finish times
  // and race each other into the recovery record, and a Retry after a partly
  // written save would then send the loser's time under the winner's
  // client_key. It guards Retry for the same reason.
  const busy = useRef(false);

  // Held in refs so the callbacks stay stable across renders; the console
  // rebuilds them every time the run changes.
  const draftCb = useRef(onDraft);
  const savedCb = useRef(onSaved);
  useEffect(() => {
    draftCb.current = onDraft;
    savedCb.current = onSaved;
  });

  const send = useCallback(
    async (run: FinishedRun) => {
      setState("saving");
      setError(null);
      let stored = false;
      try {
        await saveRunFn({ data: buildFinishPayload(run) });
        stored = true;
      } catch (e) {
        setState("failed");
        setError(e instanceof Error ? e.message : "Could not reach the server");
      }
      // Outside the catch on purpose: the row is written by this point, so a
      // throw from the caller's cleanup must not report the run as unsaved.
      if (stored) {
        setState("idle");
        await savedCb.current();
      }
    },
    [saveRunFn],
  );

  /** Stop the clock, write the record to this phone, then send it. */
  const finish = useCallback(
    async (run: ActiveRun) => {
      if (run.status === "finished" || busy.current) return;
      busy.current = true;
      try {
        const finishedAt = Date.now();
        const draft: FinishedRun = {
          ...run,
          status: "finished",
          finishedAt,
          finishedAtIso: new Date(finishedAt).toISOString(),
        };
        // Written to this phone before the network call. If the save throws the
        // run is still here, and Retry re-sends this exact record rather than
        // re-reading a clock that has moved on.
        draftCb.current(draft);
        await saveActiveRun(draft);
        await send(draft);
      } finally {
        busy.current = false;
      }
    },
    [send],
  );

  /** Send a stopped run again, unchanged. */
  const retry = useCallback(
    async (run: FinishedRun) => {
      if (busy.current) return;
      busy.current = true;
      try {
        await send(run);
      } finally {
        busy.current = false;
      }
    },
    [send],
  );

  const reset = useCallback(() => {
    setState("idle");
    setError(null);
  }, []);

  return { state, error, finish, retry, reset };
}
