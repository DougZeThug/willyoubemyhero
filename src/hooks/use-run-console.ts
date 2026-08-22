/**
 * The one implementation of "an admin is timing somebody right now".
 *
 * Lifted out of the admin route so the Live page can drive the same run from
 * its compact control bar. There is exactly one active run per device — it
 * lives in IndexedDB via src/lib/active-run.ts — so whichever screen is mounted
 * reads and writes the same record, and a run started on Live can be finished
 * on Admin.
 */
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { setParticipantStatus } from "@/lib/admin-write.functions";
import { useEventBundle } from "@/hooks/use-event-bundle";
import { asFinishedRun, useFinishSave } from "@/hooks/use-finish-save";
import { newClientKey } from "@/lib/format";
import {
  ACTIVE_RUN_CLEARED_EVENT,
  ACTIVE_RUN_VERSION,
  clearActiveRun,
  computeElapsedMs,
  loadActiveRun,
  saveActiveRun,
  type ActiveRun,
} from "@/lib/active-run";

export function useRunConsole() {
  const { event, bundle } = useEventBundle();
  const qc = useQueryClient();
  const setStatusFn = useServerFn(setParticipantStatus);

  const [run, setRun] = useState<ActiveRun | null>(null);
  const [selectedParticipantId, setSelected] = useState<string>("");

  // Hydrate active run on mount.
  useEffect(() => {
    loadActiveRun().then((r) => {
      if (r) setRun(r);
    });
  }, []);

  // Another screen (or a combine reset) wiped the stored run: drop it here too
  // rather than keep timing a record that is gone.
  useEffect(() => {
    function onCleared() {
      setRun(null);
    }
    window.addEventListener(ACTIVE_RUN_CLEARED_EVENT, onCleared);
    return () => window.removeEventListener(ACTIVE_RUN_CLEARED_EVENT, onCleared);
  }, []);

  useEffect(() => {
    if (run) saveActiveRun(run);
  }, [run]);

  const participants = useMemo(
    () => [...(bundle?.participants ?? [])].sort((a, b) => a.running_order - b.running_order),
    [bundle],
  );
  const stations = useMemo(
    () =>
      (bundle?.stations ?? [])
        .filter((s) => s.active)
        .sort((a, b) => a.station_order - b.station_order),
    [bundle],
  );

  const currentEp = run ? participants.find((p) => p.participant_id === run.participantId) : null;

  const paused = run?.status === "paused";
  const finished = run?.status === "finished";
  const elapsed = run ? computeElapsedMs(run, Date.now()) : 0;
  /** The stopped record Retry re-sends, byte for byte. */
  const finishedRun = asFinishedRun(run);

  const usedStationIds = new Set(run?.splits.map((s) => s.stationId) ?? []);

  async function startRun() {
    if (!event?.id || !selectedParticipantId) return;
    // One instant behind both anchors. Read separately they can land a tick
    // apart, and startedAtIso is what the server stores as the start time.
    const startedAt = Date.now();
    const nextRun: ActiveRun = {
      v: ACTIVE_RUN_VERSION,
      clientKey: newClientKey(),
      eventId: event.id,
      participantId: selectedParticipantId,
      startedAtIso: new Date(startedAt).toISOString(),
      startedAt,
      status: "running",
      pauses: [],
      splits: [],
      penalties: [],
    };
    setRun(nextRun);
    await saveActiveRun(nextRun);
    setSelected("");
    try {
      await setStatusFn({
        data: {
          eventId: event.id,
          eventParticipantId: participants.find((p) => p.participant_id === selectedParticipantId)!
            .id,
          status: "running",
        },
      });
    } catch {
      /* ignore */
    }
  }

  function togglePause() {
    if (!run) return;
    if (run.status === "running") {
      setRun({
        ...run,
        status: "paused",
        pauses: [...run.pauses, { pausedAt: Date.now(), resumedAt: null }],
      });
    } else if (run.status === "paused") {
      const pauses = run.pauses.slice();
      const last = pauses[pauses.length - 1];
      if (last && last.resumedAt == null) last.resumedAt = Date.now();
      setRun({ ...run, status: "running", pauses });
    }
  }

  function recordSplit(stationId: string) {
    if (!run || run.status !== "running") return;
    if (usedStationIds.has(stationId)) return;
    const now = Date.now();
    const cumulative = computeElapsedMs(run, now);
    const prevMax = run.splits.reduce((m, s) => Math.max(m, s.cumulative_time_ms), 0);
    setRun({
      ...run,
      splits: [
        ...run.splits,
        {
          clientKey: newClientKey(),
          stationId,
          cumulative_time_ms: cumulative,
          segment_time_ms: cumulative - prevMax,
          recorded_at: new Date(now).toISOString(),
        },
      ],
    });
  }

  function undoLastSplit() {
    if (!run || run.splits.length === 0) return;
    setRun({ ...run, splits: run.splits.slice(0, -1) });
  }

  function addPenalty(stationId: string | null, ms: number, reason: string) {
    if (!run) return;
    setRun({
      ...run,
      penalties: [
        ...run.penalties,
        { clientKey: newClientKey(), stationId, penalty_ms: ms, reason },
      ],
    });
  }

  const finishSave = useFinishSave({
    onDraft: setRun,
    onSaved: async () => {
      toast.success("Run saved");
      await clearActiveRun();
      setRun(null);
    },
  });
  const finishing = finishSave.state === "saving";

  // A finished run that has not reached the league is the state this console
  // used to hide entirely, so the header says so rather than a bare "Finished".
  const statusLabel = paused
    ? "Paused"
    : !finished
      ? "Running"
      : finishSave.state === "saving"
        ? "Finished — saving"
        : "Finished — not saved";

  async function finishRun() {
    if (!run) return;
    await finishSave.finish(run);
  }

  /**
   * Throw the run away. The local record goes first and unconditionally: a run
   * left over from another event — or from a save that will never land — used
   * to be unclearable, because the status write bailed out before the wipe.
   */
  async function cancelRun() {
    if (!run) return;
    const ep = participants.find((p) => p.participant_id === run.participantId);
    if (ep && event?.id) {
      try {
        await setStatusFn({
          data: { eventId: event.id, eventParticipantId: ep.id, status: "queued" },
        });
      } catch {
        /* ignore */
      }
    }
    await clearActiveRun();
    setRun(null);
    finishSave.reset();
    setSelected("");
    await qc.invalidateQueries();
  }

  /** Put someone on the clock for the crowd screens without starting the timer. */
  async function setOnClock(participantId: string | null) {
    if (!event?.id) return;
    const onClockNow = participants.find((p) => p.participation_status === "running");
    try {
      if (onClockNow && onClockNow.participant_id !== participantId) {
        await setStatusFn({
          data: { eventId: event.id, eventParticipantId: onClockNow.id, status: "waiting" },
        });
      }
      if (participantId) {
        const ep = participants.find((p) => p.participant_id === participantId);
        if (ep) {
          await setStatusFn({
            data: { eventId: event.id, eventParticipantId: ep.id, status: "running" },
          });
        }
      }
      await qc.invalidateQueries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update the clock");
    }
  }

  return {
    event,
    run,
    participants,
    stations,
    currentEp,
    paused,
    finished,
    finishing,
    elapsed,
    finishedRun,
    finishSave,
    statusLabel,
    usedStationIds,
    selectedParticipantId,
    setSelected,
    startRun,
    togglePause,
    recordSplit,
    undoLastSplit,
    addPenalty,
    finishRun,
    cancelRun,
    setOnClock,
  };
}

export type RunConsole = ReturnType<typeof useRunConsole>;
