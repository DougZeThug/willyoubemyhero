/**
 * The commissioner's controls, docked under the crowd's clock.
 *
 * Timing used to mean standing on the Admin tab while everyone else watched
 * Live. This is the same run — same IndexedDB record, same save path — driven
 * from the broadcast view: start, split at each station, pause, finish. The
 * heavy console (penalties, cancel, roster edits) stays on /admin.
 *
 * Renders nothing at all without a valid admin session for the active event.
 */
import { useState } from "react";
import { Flag, Pause, Pencil, Play, Radio, Redo2, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EditResultSheet } from "@/components/edit-result-sheet";
import { formatTime } from "@/lib/format";
import { currentAthlete } from "@/lib/current-athlete";
import type { RunConsole } from "@/hooks/use-run-console";

export function LiveTimingBar({ console: rc }: { console: RunConsole }) {
  const {
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
    selectedParticipantId,
    setSelected,
    startRun,
    togglePause,
    recordSplit,
    undoLastSplit,
    finishRun,
    cancelRun,
    resetAthlete,
    setOnClock,
  } = rc;

  const eventId = event?.id ?? null;
  const [editing, setEditing] = useState<string | null>(null);


  const queued = participants.filter(
    (p) => p.participation_status !== "finished" && p.participation_status !== "scratched",
  );
  const slot = currentAthlete(participants);
  // Anyone already timed — the commissioner needs a way to undo one bad result
  // without resetting the whole combine.
  const done = participants.filter((p) => p.participation_status === "finished");

  // The picker defaults to whoever is next in running order, so the common case
  // is one tap: Start.
  const pick = selectedParticipantId || slot.athlete?.participant_id || "";

  return (
    <section
      aria-label="Admin timing controls"
      className="hud-bezel rounded-lg border border-primary/30 bg-[oklch(0.14_0.02_240)]/80 p-3"
    >
      <div className="mb-2 flex items-center gap-2">
        <Radio className="h-3.5 w-3.5 text-primary" />
        <span className="font-display text-[10px] font-black uppercase tracking-[0.3em] text-primary/80">
          Commissioner
        </span>
        <Badge variant="secondary" className="h-4 px-1.5 text-[9px] uppercase">
          Admin
        </Badge>
        {run && (
          <span className="ml-auto text-[10px] uppercase tracking-[0.28em] text-muted-foreground">
            {statusLabel}
          </span>
        )}
      </div>

      {!run ? (
        <div className="space-y-2">
          <div className="flex gap-2">
            <select
              aria-label="Athlete on deck"
              value={pick}
              onChange={(e) => setSelected(e.target.value)}
              className="min-w-0 flex-1 rounded-md border border-white/10 bg-white/5 px-2 py-2 text-sm font-semibold uppercase"
            >
              {queued.map((p) => (
                <option key={p.id} value={p.participant_id}>
                  {p.running_order}. {p.participant?.name ?? "—"}
                </option>
              ))}
              {queued.length === 0 && <option value="">No athletes left</option>}
            </select>
            <Button
              size="sm"
              variant="secondary"
              className="h-auto"
              onClick={() => setOnClock(slot.onClock ? null : pick)}
              disabled={!pick && !slot.onClock}
            >
              {slot.onClock ? "Clear" : "On clock"}
            </Button>
          </div>
          <Button className="h-12 w-full" disabled={!pick} onClick={startRun}>
            <Play className="mr-2 h-5 w-5" /> Start Timer
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate font-display text-lg font-black uppercase leading-tight">
                {currentEp?.participant?.name ?? "—"}
              </div>
            </div>
            <div className="timer-digits tabular text-2xl text-primary">{formatTime(elapsed)}</div>
          </div>

          {finished ? (
            <div className="space-y-2">
              <p className="text-center text-xs text-warn">
                {finishSave.state === "saving"
                  ? "Sending this run to the league…"
                  : `${finishSave.error ?? "The save did not go through."} The run is safe on this phone — retry once you have signal.`}
              </p>
              {finishedRun && (
                <Button
                  className="h-12 w-full"
                  disabled={finishing}
                  onClick={() => finishSave.retry(finishedRun)}
                >
                  <RotateCcw className="mr-1.5 h-4 w-4" />
                  {finishing ? "Saving…" : "Retry save"}
                </Button>
              )}
            </div>
          ) : (
            <>
              <div className="flex gap-2">
                <Button
                  variant={paused ? "default" : "secondary"}
                  className="h-12 flex-1"
                  onClick={togglePause}
                >
                  {paused ? (
                    <>
                      <Play className="mr-1.5 h-4 w-4" /> Resume
                    </>
                  ) : (
                    <>
                      <Pause className="mr-1.5 h-4 w-4" /> Pause
                    </>
                  )}
                </Button>
                <Button className="h-12 flex-1" onClick={finishRun} disabled={finishing}>
                  <Flag className="mr-1.5 h-4 w-4" /> {finishing ? "Saving…" : "Finish"}
                </Button>
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-display text-[10px] font-bold uppercase tracking-[0.28em] text-muted-foreground">
                    Splits
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={undoLastSplit}
                    disabled={run.splits.length === 0}
                  >
                    <Redo2 className="mr-1 h-3.5 w-3.5" /> Undo
                  </Button>
                </div>
                <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                  {stations.map((st) => {
                    const split = run.splits.find((s) => s.stationId === st.id);
                    const disabled = !!split || run.status !== "running";
                    return (
                      <button
                        key={st.id}
                        disabled={disabled}
                        onClick={() => recordSplit(st.id)}
                        className={
                          "min-w-28 shrink-0 rounded-md border p-2 text-left transition " +
                          (split
                            ? "border-primary/40 bg-primary/10"
                            : disabled
                              ? "border-white/5 bg-white/5 opacity-60"
                              : "border-white/10 bg-white/5 hover:border-primary hover:bg-primary/10")
                        }
                      >
                        <div className="truncate font-display text-sm font-black uppercase leading-tight">
                          {st.short_name ?? st.name}
                        </div>
                        <div className="timer-digits tabular text-sm text-primary">
                          {split ? formatTime(split.cumulative_time_ms) : "—"}
                        </div>
                      </button>
                    );
                  })}
                  {stations.length === 0 && (
                    <span className="px-1 py-2 text-xs text-muted-foreground">
                      No stations set up.
                    </span>
                  )}
                </div>
              </div>
            </>
          )}

          {/* The way out of a timer that is simply wrong — a mis-started run, or
              a finished one that will never save. Nothing is written to the
              league, so the athlete just goes back in the queue. */}
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-destructive hover:bg-destructive/10"
            onClick={() => {
              if (confirm("Throw this timer away and put the athlete back in the queue?")) {
                cancelRun();
              }
            }}
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Reset timer
          </Button>
        </div>
      )}

      {done.length > 0 && (
        <div className="mt-3 border-t border-white/10 pt-2">
          <div className="mb-1 font-display text-[10px] font-bold uppercase tracking-[0.28em] text-muted-foreground">
            Fix a result
          </div>
          <ul className="max-h-52 space-y-0.5 overflow-auto pr-1">
            {done.map((p) => {
              const playerName = p.participant?.name ?? "player";
              return (
                <li key={p.id} className="flex items-center justify-between gap-1 text-xs">
                  <span className="min-w-0 flex-1 truncate uppercase">{playerName}</span>
                  {eventId && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 shrink-0 px-2 text-[10px] uppercase tracking-widest"
                      onClick={() => setEditing(p.participant_id)}
                    >
                      <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 shrink-0 px-2 text-[10px] uppercase tracking-widest text-destructive hover:bg-destructive/10"
                    onClick={() => {
                      if (confirm(`Clear ${playerName}'s run and put them back in the queue?`)) {
                        resetAthlete(p.participant_id);
                      }
                    }}
                  >
                    <RotateCcw className="mr-1 h-3.5 w-3.5" /> Reset
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {eventId && editing && (
        <EditResultSheet
          eventId={eventId}
          participantId={editing}
          participantName={
            done.find((p) => p.participant_id === editing)?.participant?.name ?? "Athlete"
          }
          open={!!editing}
          onOpenChange={(o) => !o && setEditing(null)}
        />
      )}

    </section>
  );
}
