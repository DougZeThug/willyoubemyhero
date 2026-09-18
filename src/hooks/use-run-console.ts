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
import { resetParticipantRuns, setParticipantStatus } from "@/lib/admin-write.functions";
import { useEventBundle } from "@/hooks/use-event-bundle";
import { asFinishedRun, useFinishSave } from "@/hooks/use-finish-save";
import { awaitingRun, OUT_OF_FIELD_MESSAGE, refusedStart } from "@/lib/current-athlete";
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
  const resetAthleteFn = useServerFn(resetParticipantRuns);

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
        // `split_enabled` as well as `active`: the stations panel writes it,
        // confirms it, and this filtered on `active` alone — so the switch
        // saved faithfully and changed nothing.
        .filter((s) => s.active && s.split_enabled !== false)
        .sort((a, b) => a.station_order - b.station_order),
    [bundle],
  );

  // If a realtime update removes the selected athlete from the roster, drop the
  // stale selection before Start Run can try to use it.
  useEffect(() => {
    if (
      selectedParticipantId &&
      !participants.some((p) => p.participant_id === selectedParticipantId)
    ) {
      setSelected("");
    }
  }, [selectedParticipantId, participants]);

  const currentEp = run ? participants.find((p) => p.participant_id === run.participantId) : null;

  const paused = run?.status === "paused";
  const finished = run?.status === "finished";
  const elapsed = run ? computeElapsedMs(run, Date.now()) : 0;
  /** The stopped record Retry re-sends, byte for byte. */
  const finishedRun = asFinishedRun(run);

  const usedStationIds = new Set(run?.splits.map((s) => s.stationId) ?? []);

  /**
   * @param participantId the athlete to start, for a caller whose control shows a
   * default it never committed to state. Live's bar is the one that does: its
   * picker falls back to whoever is next in running order, so a bare tap on Start
   * was reading an empty selection and returning without writing a run — enabled
   * button, no timer, no error. Admin's card seeds the selection instead and can
   * still call this with nothing.
   */
  async function startRun(participantId?: string) {
    const target = participantId || selectedParticipantId;
    if (!event?.id || !target) return;
    const ep = participants.find((p) => p.participant_id === target);
    if (!ep) {
      // The athlete was removed from the roster while this screen was open.
      // Starting a timer for a ghost row would leave an orphaned local run that
      // can never sync, so stop before we write anything.
      toast.error("That athlete is no longer on the roster.");
      setSelected("");
      return;
    }
    if (!awaitingRun(ep)) {
      // On the roster but out of the field — scratched between this screen
      // rendering and the tap, which is one tap with no confirm on the roster
      // panel. Starting them writes "running", which un-scratches them and puts
      // them back on the crowd clock. The effect above only clears a selection
      // whose athlete has LEFT the roster, and a scratch does not.
      toast.error(OUT_OF_FIELD_MESSAGE);
      setSelected("");
      return;
    }
    // One instant behind both anchors. Read separately they can land a tick
    // apart, and startedAtIso is what the server stores as the start time.
    const startedAt = Date.now();
    const nextRun: ActiveRun = {
      v: ACTIVE_RUN_VERSION,
      clientKey: newClientKey(),
      eventId: event.id,
      participantId: target,
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
    // Only ONE athlete is ever on the crowd's clock, and nothing below this hook
    // enforces it: the column has no CHECK, the handler writes the one row it is
    // given, and currentAthlete takes the first "running" row it finds in an
    // unsorted list. setOnClock has always demoted before promoting; this did
    // not, so staging B and then starting C left both rows "running" and the
    // spectator screens naming B for the whole of C's run — and still naming B
    // after it, until somebody tapped Clear.
    //
    // Scoped to a DIFFERENT athlete on purpose. Starting the person already on
    // the clock is the ordinary path, and demoting them would clear
    // on_clock_since and re-stamp it at the Start tap, losing the moment they
    // actually stepped up — which setParticipantStatus goes out of its way to
    // keep.
    const onClockNow = participants.find(
      (p) => p.participation_status === "running" && p.participant_id !== target,
    );
    try {
      await setStatusFn({
        data: { eventId: event.id, eventParticipantId: ep.id, status: "running" },
      });
      // AFTER the promote, not before it, which is the opposite of setOnClock's
      // order and deliberate. The write above can be refused — another phone
      // scratching this athlete gets past the check above, and the branch below
      // then tears the local run down. Demoting first, that refusal left the
      // crowd's clock EMPTY: the previous athlete already written to "waiting"
      // and nobody put in their place. Taking the clock before giving it up
      // means a refused start leaves them exactly where they were.
      //
      // The cost is one round trip in which both rows read "running", against a
      // bug that lasted until somebody noticed. And for that round trip the
      // screens go on showing the athlete they were already showing.
      if (onClockNow) {
        try {
          await setStatusFn({
            data: { eventId: event.id, eventParticipantId: onClockNow.id, status: "waiting" },
          });
        } catch {
          // A cleanup that fails must not undo a start that worked. The timer is
          // running and the crowd has the right name; a stale row costs the
          // previous athlete showing as on-deck until the next write moves them.
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      // Both of the server's refusals, not just the scratch. The check above
      // reads this device's last bundle, so another phone scratching this
      // athlete — or deleting them off the roster outright — gets past it and
      // the server is the first to know, by which point the timer is already
      // running locally and saved to IndexedDB.
      //
      // Left standing, that run is worse than no run. Finishing it goes through
      // saveCompletedRun, and both refusals have a way for that to hurt: a
      // scratched athlete gets written back to "finished", undoing the scratch
      // by another door — exactly what the server guard exists to stop — and a
      // deleted one gets an official run with no roster row behind it, which
      // standings() ranks anyway. So it goes, and the roster read catches this
      // screen up.
      const refusal = refusedStart(message);
      if (refusal) {
        await clearActiveRun();
        setRun(null);
        setSelected("");
        await qc.invalidateQueries();
        toast.error(refusal);
        return;
      }
      // Anything else is the network, and the run stays: a commissioner is
      // standing in a garden with somebody already running, and losing the timer
      // to a blip costs more than a status flag that catches up late.
      toast.error(message || "Could not start the run on the server.");
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

  // Both of these stop at `finished`, and deliberately not at `paused`: a
  // commissioner who pauses to argue about a split should still be able to take
  // it back, and recording one is blocked while paused only because the clock
  // reading would be meaningless.
  //
  // `finished` is the state that matters, because the record Retry save sends is
  // derived live from `run` rather than snapshotted at Finish. saveCompletedRun
  // writes splits with `onConflict: "client_key"`, which can add and update but
  // cannot delete a row by absence — so an undo after a save that committed the
  // splits and then failed later is silently lost on the retry, which goes on to
  // report "Run saved". Retry save re-sends the identical record; it can only do
  // that if the record cannot move underneath it.
  function undoLastSplit() {
    if (!run || run.status === "finished" || run.splits.length === 0) return;
    setRun({ ...run, splits: run.splits.slice(0, -1) });
  }

  function addPenalty(stationId: string | null, ms: number, reason: string) {
    if (!run || run.status === "finished") return;
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
          // "waiting", like every other reset in the app: it is the schema
          // default and the word players actually see. "queued" behaves
          // identically and was the only place that wrote it.
          data: { eventId: event.id, eventParticipantId: ep.id, status: "waiting" },
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

  /**
   * Wipe one athlete's result so they can run again. If the active timer on
   * this device belongs to them it goes too — otherwise a stale local run
   * would re-save the result we just deleted.
   */
  async function resetAthlete(participantId: string) {
    if (!event?.id) return;
    try {
      const res = await resetAthleteFn({ data: { eventId: event.id, participantId } });
      if (run?.participantId === participantId) {
        await clearActiveRun();
        setRun(null);
        finishSave.reset();
        setSelected("");
      }
      await qc.invalidateQueries();
      toast.success(`Reset — ${res.clearedRuns} run(s) cleared`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not reset that athlete");
    }
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
    resetAthlete,
    setOnClock,
  };
}

export type RunConsole = ReturnType<typeof useRunConsole>;
