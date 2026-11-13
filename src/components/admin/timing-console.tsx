import { useQueryClient } from "@tanstack/react-query";
import { clearAdminToken } from "@/lib/admin-token";
import { useEventBundle } from "@/hooks/use-event-bundle";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ParticipantAvatar } from "@/components/participant-avatar";
import { BigTimer } from "@/components/big-timer";
import { formatTime } from "@/lib/format";
import {
  Flag,
  LogOut,
  Pause,
  Play,
  Plus,
  Redo2,
  Timer as TimerIcon,
  X,
  Camera,
  Archive,
  Trash2,
  RotateCcw,
} from "lucide-react";
import { useRunConsole } from "@/hooks/use-run-console";
import { FeedDegradedBanner } from "@/components/feed-state";
import { cn } from "@/lib/utils";
import { EventOpsPanel } from "@/components/admin/event-ops-panel";
import { StartCard } from "@/components/admin/start-card";

export function TimingConsole() {
  const qc = useQueryClient();
  // The console watches the same event channel every spectator screen does
  // and was the one that never said when it was down.
  const { error: bundleError, realtimeDegraded } = useEventBundle();
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
    addPenalty,
    finishRun,
    cancelRun,
    setOnClock,
  } = useRunConsole();

  async function signOut() {
    clearAdminToken();
    await qc.invalidateQueries();
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-4">
      {/* The one that matters most: this is where a run is timed, and a
          console frozen behind a dead socket with nothing on screen saying
          so is the failure the health states were added for. */}
      {(realtimeDegraded || Boolean(bundleError)) && <FeedDegradedBanner />}
      <div className="flex items-end justify-between gap-2 border-b border-primary/20 pb-3">
        <div>
          <div className="flex items-center gap-2 text-primary">
            <TimerIcon className="h-4 w-4" />
            <span className="font-display text-label font-bold uppercase tracking-[0.08em]">
              Console
            </span>
            <Badge variant="secondary" className="ml-1 h-4 px-1.5 text-label uppercase">
              Admin
            </Badge>
          </div>
          <h1 className="mt-1 font-display text-2xl font-black uppercase leading-none">
            Timing Console
          </h1>
        </div>
        <Button variant="ghost" size="sm" onClick={signOut}>
          <LogOut className="mr-1.5 h-4 w-4" />
          Lock
        </Button>
      </div>

      {event?.id && (
        <div>
          <div className="mb-2">
            <div className="flex items-center gap-2 text-primary">
              <Camera className="h-4 w-4" />
              <span className="font-display text-label font-bold uppercase tracking-[0.08em]">
                Event Setup
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Tap any participant below to upload or replace their square photo. This panel also
              holds the spectator QR code and the Archive Event button.
            </p>
          </div>
          <EventOpsPanel eventId={event.id} eventName={event.name ?? "Combine"} />
        </div>
      )}

      {!run ? (
        <StartCard
          participants={participants}
          selectedParticipantId={selectedParticipantId}
          onSelect={setSelected}
          onStart={startRun}
          onSetOnClock={setOnClock}
        />
      ) : (
        <Card className={cn("hud-bezel", paused ? "border-warn/60" : "border-primary/50 hud-glow")}>
          <CardContent className="p-4 sm:p-5">
            <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-center gap-3">
                <ParticipantAvatar
                  name={currentEp?.participant?.name ?? "?"}
                  photoUrl={currentEp?.participant?.profile_image_url ?? null}
                  size={64}
                />
                <div>
                  <div
                    className={cn(
                      "text-xs font-bold uppercase tracking-[0.08em]",
                      finished ? "text-warn" : "text-muted-foreground",
                    )}
                  >
                    {statusLabel}
                  </div>
                  <div className="font-display text-2xl font-black uppercase leading-tight">
                    {currentEp?.participant?.name ?? "—"}
                  </div>
                </div>
              </div>
              <BigTimer runningSinceMs={elapsed} paused={paused || finished} />
            </div>

            {finished ? (
              <div className="mt-4 space-y-2">
                <p className="text-center text-sm text-warn">
                  {finishSave.state === "saving"
                    ? "Sending this run to the league…"
                    : `${finishSave.error ?? "The save did not go through."} The run is safe on this phone — retry once you have signal.`}
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  {finishedRun && (
                    <Button
                      size="lg"
                      onClick={() => finishSave.retry(finishedRun)}
                      disabled={finishing}
                      className="h-12 flex-1 sm:h-10 sm:min-w-28 sm:flex-none"
                    >
                      <RotateCcw className="mr-1.5 h-4 w-4" />
                      {finishing ? "Saving…" : "Retry save"}
                    </Button>
                  )}
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        size="lg"
                        variant="ghost"
                        disabled={finishing}
                        className="h-12 w-full sm:h-10 sm:w-auto"
                      >
                        <Trash2 className="mr-1.5 h-4 w-4" /> Discard
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Discard this run?</AlertDialogTitle>
                        <AlertDialogDescription>
                          {`${currentEp?.participant?.name ?? "This athlete"} ran ${formatTime(elapsed)}.`}{" "}
                          Discarding throws that time away and puts them back in the queue. Nobody
                          runs the course twice, so there is no undo.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Keep it</AlertDialogCancel>
                        <AlertDialogAction onClick={cancelRun}>Discard</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            ) : (
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <Button
                  size="lg"
                  variant={paused ? "default" : "secondary"}
                  onClick={togglePause}
                  className="h-12 flex-1 sm:h-10 sm:min-w-28 sm:flex-none"
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
                <Button
                  size="lg"
                  onClick={finishRun}
                  disabled={finishing}
                  className="h-12 flex-1 sm:h-10 sm:min-w-28 sm:flex-none"
                >
                  <Flag className="mr-1.5 h-4 w-4" /> {finishing ? "Saving…" : "Finish"}
                </Button>
                <Button
                  size="lg"
                  variant="ghost"
                  onClick={cancelRun}
                  className="h-12 w-full sm:h-10 sm:w-auto"
                >
                  <X className="mr-1.5 h-4 w-4" /> Cancel
                </Button>
              </div>
            )}

            <div className="mt-6">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-display text-sm font-bold uppercase tracking-[0.08em] text-muted-foreground">
                  Stations & Splits
                </h3>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={undoLastSplit}
                  // `finished` for the same reason the penalty chip below
                  // carries it: the finished record is what Retry save re-sends.
                  disabled={run.splits.length === 0 || finished}
                >
                  <Redo2 className="mr-1 h-3.5 w-3.5" /> Undo split
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {stations.map((st) => {
                  const split = run.splits.find((s) => s.stationId === st.id);
                  const disabled = Boolean(split) || paused || finished || run.status !== "running";
                  return (
                    <div key={st.id} className="flex flex-col gap-1">
                      <button
                        disabled={disabled}
                        onClick={() => recordSplit(st.id)}
                        className={cn(
                          "rounded-md border p-3 text-left transition",
                          split
                            ? "border-primary/40 bg-primary/10"
                            : disabled
                              ? "border-white/5 bg-white/5 opacity-60"
                              : "border-border-strong bg-white/5 hover:border-primary hover:bg-primary/10",
                        )}
                      >
                        <div className="text-label font-bold uppercase tracking-[0.08em] text-muted-foreground">
                          {st.short_name ?? `#${st.station_order}`}
                        </div>
                        <div className="truncate font-display text-lg font-black uppercase leading-tight">
                          {st.name}
                        </div>
                        <div className="mt-1 timer-digits tabular text-primary text-base">
                          {split ? formatTime(split.cumulative_time_ms) : "—"}
                        </div>
                      </button>
                      {st.penalty_amount_ms > 0 && (
                        <button
                          onClick={() =>
                            addPenalty(st.id, st.penalty_amount_ms, `${st.name} penalty`)
                          }
                          disabled={finished}
                          className="min-h-9 rounded-md border border-warn/30 bg-warn/10 py-1 text-label font-bold uppercase tracking-[0.08em] text-warn hover:bg-warn/20 disabled:opacity-50 sm:min-h-0"
                        >
                          <Plus className="mr-1 inline h-3 w-3" />+
                          {formatTime(st.penalty_amount_ms)} pen
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {run.penalties.length > 0 && (
              <div className="mt-4">
                <h3 className="mb-1 font-display text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">
                  Penalties
                </h3>
                <ul className="space-y-1 text-sm">
                  {run.penalties.map((p) => (
                    <li
                      key={p.clientKey}
                      className="flex justify-between rounded bg-warn/10 px-2 py-1"
                    >
                      <span>{p.reason ?? "Penalty"}</span>
                      <span className="text-warn tabular">+{formatTime(p.penalty_ms)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
