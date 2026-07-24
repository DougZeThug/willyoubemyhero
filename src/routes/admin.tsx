import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { adminSignOut, getAdminStatus, verifyEventPin } from "@/lib/admin.functions";
import {
  saveCompletedRun,
  setParticipantStatus,
} from "@/lib/admin-write.functions";
import {
  archiveEvent,
  uploadParticipantPhoto,
} from "@/lib/media.functions";
import { useEventPhotoUrls } from "@/hooks/use-photo-urls";
import { useEventBundle } from "@/hooks/use-event-bundle";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ParticipantAvatar } from "@/components/participant-avatar";
import { BigTimer } from "@/components/big-timer";
import { formatTime, newClientKey } from "@/lib/format";
import {
  clearActiveRun,
  computeElapsedMs,
  loadActiveRun,
  saveActiveRun,
  type ActiveRun,
} from "@/lib/active-run";
import {
  Flag,
  LockKeyhole,
  LogOut,
  Pause,
  Play,
  Plus,
  Redo2,
  Timer as TimerIcon,
  X,
  QrCode,
  Camera,
  Archive,
  ExternalLink,
} from "lucide-react";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin — Will YOU Be My Hero? Draft Combine" },
      { name: "description", content: "Timing console and event controls for combine admins." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminPage,
});

function AdminPage() {
  const { event } = useEventBundle();
  const adminStatusFn = useServerFn(getAdminStatus);
  const status = useQuery({
    queryKey: ["admin-status"],
    queryFn: () => adminStatusFn(),
    staleTime: 30_000,
  });

  const isAdmin = !!event?.id && status.data?.eventId === event.id;

  if (status.isLoading || !event || !event.id) {
    return (
      <div className="mx-auto max-w-md p-6 text-sm text-muted-foreground">Loading…</div>
    );
  }

  return isAdmin ? <TimingConsole /> : <PinGate eventId={event.id} eventName={event.name ?? "Combine"} />;
}

// ---------------- PIN GATE ----------------
function PinGate({ eventId, eventName }: { eventId: string; eventName: string }) {
  const verifyFn = useServerFn(verifyEventPin);
  const qc = useQueryClient();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await verifyFn({ data: { eventId, pin } });
      if (!res.ok) {
        toast.error("Incorrect PIN");
        setPin("");
        return;
      }
      toast.success("Admin unlocked");
      await qc.invalidateQueries({ queryKey: ["admin-status"] });
    } catch {
      toast.error("Could not verify PIN");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto grid min-h-[60vh] max-w-md place-items-center px-4 py-10">
      <Card className="hud-bezel w-full border-white/10">
        <CardContent className="p-6">
          <div className="mb-4">
            <div className="flex items-center gap-2 text-primary">
              <LockKeyhole className="h-4 w-4" />
              <span className="font-display text-[10px] font-bold uppercase tracking-[0.3em]">Console</span>
            </div>
            <h1 className="mt-1 font-display text-2xl font-black uppercase leading-none">Admin Access</h1>
          </div>
          <p className="mb-4 text-sm text-muted-foreground">
            Enter the event PIN for <span className="text-foreground">{eventName}</span> to unlock
            timing and controls on this device.
          </p>
          <form onSubmit={submit} className="space-y-3">
            <Label htmlFor="pin">Event PIN</Label>
            <Input
              id="pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              autoFocus
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              className="text-center font-display text-2xl tracking-[0.4em]"
            />
            <Button type="submit" disabled={busy || !pin} className="w-full">
              {busy ? "Checking…" : "Unlock"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------- TIMING CONSOLE ----------------
function TimingConsole() {
  const { event, bundle } = useEventBundle();
  const qc = useQueryClient();
  const signOutFn = useServerFn(adminSignOut);
  const saveRunFn = useServerFn(saveCompletedRun);
  const setStatusFn = useServerFn(setParticipantStatus);

  const [run, setRun] = useState<ActiveRun | null>(null);
  const [selectedParticipantId, setSelected] = useState<string>("");

  // Hydrate active run on mount.
  useEffect(() => {
    loadActiveRun().then((r) => {
      if (r) setRun(r);
    });
  }, []);

  useEffect(() => {
    if (run) saveActiveRun(run);
  }, [run]);

  const participants = useMemo(
    () => [...(bundle?.participants ?? [])].sort((a, b) => a.running_order - b.running_order),
    [bundle],
  );
  const stations = useMemo(
    () => (bundle?.stations ?? []).filter((s) => s.active).sort((a, b) => a.station_order - b.station_order),
    [bundle],
  );

  const currentEp = run
    ? participants.find((p) => p.participant_id === run.participantId)
    : null;

  const paused = run?.status === "paused";
  const finished = run?.status === "finished";
  const elapsed = run ? computeElapsedMs(run, performance.now()) : 0;

  const usedStationIds = new Set(run?.splits.map((s) => s.stationId) ?? []);

  async function signOut() {
    await signOutFn();
    await qc.invalidateQueries({ queryKey: ["admin-status"] });
  }

  async function startRun() {
    if (!event?.id || !selectedParticipantId) return;
    const startedAtPerf = performance.now();
    const startedAtIso = new Date().toISOString();
    const nextRun: ActiveRun = {
      clientKey: newClientKey(),
      eventId: event.id,
      participantId: selectedParticipantId,
      startedAtIso,
      startedAtPerf,
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
          eventParticipantId: participants.find((p) => p.participant_id === selectedParticipantId)!.id,
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
      setRun({ ...run, status: "paused", pauses: [...run.pauses, { pausedAt: performance.now(), resumedAt: null }] });
    } else if (run.status === "paused") {
      const pauses = run.pauses.slice();
      const last = pauses[pauses.length - 1];
      if (last && last.resumedAt == null) last.resumedAt = performance.now();
      setRun({ ...run, status: "running", pauses });
    }
  }

  function recordSplit(stationId: string) {
    if (!run || run.status !== "running") return;
    if (usedStationIds.has(stationId)) return;
    const cumulative = computeElapsedMs(run, performance.now());
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
          recorded_at: new Date().toISOString(),
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

  async function finishRun() {
    if (!run || !event?.id) return;
    const finishedAtPerf = performance.now();
    const finishedAtIso = new Date().toISOString();
    const raw_time_ms = computeElapsedMs({ ...run, status: "finished", finishedAtPerf }, finishedAtPerf);
    const paused_duration_ms = run.pauses.reduce(
      (s, p) => s + ((p.resumedAt ?? finishedAtPerf) - p.pausedAt),
      0,
    );
    const draft = { ...run, status: "finished" as const, finishedAtIso, finishedAtPerf };
    setRun(draft);
    await saveActiveRun(draft);
    try {
      await saveRunFn({
        data: {
          eventId: event.id,
          participantId: run.participantId,
          clientKey: run.clientKey,
          started_at: run.startedAtIso,
          finished_at: finishedAtIso,
          raw_time_ms,
          paused_duration_ms: Math.round(paused_duration_ms),
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
        },
      });
      toast.success("Run saved");
      await clearActiveRun();
      setRun(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save run — kept locally");
    }
  }

  async function cancelRun() {
    if (!run || !event?.id) return;
    const ep = participants.find((p) => p.participant_id === run.participantId);
    if (ep) {
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
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-4">
      <div className="flex items-end justify-between gap-2 border-b border-primary/20 pb-3">
        <div>
          <div className="flex items-center gap-2 text-primary">
            <TimerIcon className="h-4 w-4" />
            <span className="font-display text-[10px] font-bold uppercase tracking-[0.3em]">Console</span>
            <Badge variant="secondary" className="ml-1 h-4 px-1.5 text-[9px] uppercase">Admin</Badge>
          </div>
          <h1 className="mt-1 font-display text-2xl font-black uppercase leading-none">Timing Console</h1>
        </div>
        <Button variant="ghost" size="sm" onClick={signOut}>
          <LogOut className="mr-1.5 h-4 w-4" />
          Lock
        </Button>
      </div>

      {!run ? (
        <StartCard
          participants={participants}
          selectedParticipantId={selectedParticipantId}
          onSelect={setSelected}
          onStart={startRun}
        />
      ) : (
        <Card className={"hud-bezel " + (paused ? "border-warn/60" : "border-primary/50 hud-glow")}>
          <CardContent className="p-5">
            <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-center gap-3">
                <ParticipantAvatar
                  name={currentEp?.participant?.name ?? "?"}
                  photoUrl={currentEp?.participant?.profile_image_url ?? null}
                  size={64}
                />
                <div>
                  <div className="text-xs font-bold uppercase tracking-[0.28em] text-muted-foreground">
                    {paused ? "Paused" : finished ? "Finished" : "Running"}
                  </div>
                  <div className="font-display text-2xl font-black uppercase leading-tight">
                    {currentEp?.participant?.name ?? "—"}
                  </div>
                </div>
              </div>
              <BigTimer runningSinceMs={elapsed} paused={paused || finished} />
            </div>

            {!finished && (
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <Button
                  size="lg"
                  variant={paused ? "default" : "secondary"}
                  onClick={togglePause}
                  className="min-w-28"
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
                <Button size="lg" onClick={finishRun} className="min-w-28">
                  <Flag className="mr-1.5 h-4 w-4" /> Finish
                </Button>
                <Button size="lg" variant="ghost" onClick={cancelRun}>
                  <X className="mr-1.5 h-4 w-4" /> Cancel
                </Button>
              </div>
            )}

            <div className="mt-6">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-display text-sm font-bold uppercase tracking-widest text-muted-foreground">
                  Stations & Splits
                </h3>
                <Button size="sm" variant="ghost" onClick={undoLastSplit} disabled={run.splits.length === 0}>
                  <Redo2 className="mr-1 h-3.5 w-3.5" /> Undo split
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {stations.map((st) => {
                  const split = run.splits.find((s) => s.stationId === st.id);
                  const disabled = !!split || paused || finished || run.status !== "running";
                  return (
                    <div key={st.id} className="flex flex-col gap-1">
                      <button
                        disabled={disabled}
                        onClick={() => recordSplit(st.id)}
                        className={
                          "rounded-md border p-3 text-left transition " +
                          (split
                            ? "border-primary/40 bg-primary/10"
                            : disabled
                              ? "border-white/5 bg-white/5 opacity-60"
                              : "border-white/10 bg-white/5 hover:border-primary hover:bg-primary/10")
                        }
                      >
                        <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
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
                          onClick={() => addPenalty(st.id, st.penalty_amount_ms, `${st.name} penalty`)}
                          disabled={finished}
                          className="rounded-md border border-warn/30 bg-warn/10 py-1 text-[10px] font-bold uppercase tracking-widest text-warn hover:bg-warn/20 disabled:opacity-50"
                        >
                          <Plus className="mr-1 inline h-3 w-3" />+{formatTime(st.penalty_amount_ms)} pen
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {run.penalties.length > 0 && (
              <div className="mt-4">
                <h3 className="mb-1 font-display text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  Penalties
                </h3>
                <ul className="space-y-1 text-sm">
                  {run.penalties.map((p) => (
                    <li key={p.clientKey} className="flex justify-between rounded bg-warn/10 px-2 py-1">
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
      <EventOpsPanel eventId={event.id} eventName={event?.name ?? "Combine"} />
    </div>
  );
}

function StartCard({
  participants,
  selectedParticipantId,
  onSelect,
  onStart,
}: {
  participants: NonNullable<ReturnType<typeof useEventBundle>["bundle"]>["participants"];
  selectedParticipantId: string;
  onSelect: (id: string) => void;
  onStart: () => void;
}) {
  const queued = participants.filter(
    (p) => p.participation_status !== "finished" && p.participation_status !== "scratched",
  );
  const nextUp = queued[0];
  useEffect(() => {
    if (!selectedParticipantId && nextUp) onSelect(nextUp.participant_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextUp?.participant_id]);

  return (
    <Card>
      <CardContent className="p-5">
        <h2 className="mb-3 font-display text-xl font-black uppercase">Send next athlete</h2>
        <div className="max-h-72 overflow-auto rounded border border-white/5 divide-y divide-white/5">
          {queued.map((p) => {
            const sel = p.participant_id === selectedParticipantId;
            return (
              <button
                key={p.id}
                onClick={() => onSelect(p.participant_id)}
                className={
                  "flex w-full items-center gap-3 px-3 py-2 text-left transition " +
                  (sel ? "bg-primary/15" : "hover:bg-white/5")
                }
              >
                <span className="grid h-7 w-7 place-items-center rounded-md bg-white/5 font-display text-sm font-black tabular">
                  {p.running_order}
                </span>
                <ParticipantAvatar
                  name={p.participant?.name ?? "?"}
                  photoUrl={p.participant?.profile_image_url ?? null}
                  size={32}
                />
                <span className="flex-1 truncate font-semibold uppercase">
                  {p.participant?.name}
                </span>
                {sel && (
                  <Badge className="bg-primary text-primary-foreground">Next</Badge>
                )}
              </button>
            );
          })}
          {queued.length === 0 && (
            <div className="p-4 text-center text-sm text-muted-foreground">
              No athletes left in the queue.
            </div>
          )}
        </div>
        <Button
          className="mt-4 w-full"
          size="lg"
          disabled={!selectedParticipantId}
          onClick={onStart}
        >
          <Play className="mr-2 h-5 w-5" />
          Start Timer
        </Button>
      </CardContent>
    </Card>
  );
}