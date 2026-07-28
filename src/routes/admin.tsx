import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { verifyEventPin } from "@/lib/admin.functions";
import { clearAdminToken, setAdminToken, useAdminSession } from "@/lib/admin-token";
import { saveCompletedRun, setParticipantStatus } from "@/lib/admin-write.functions";
import {
  upsertParticipant,
  addParticipantToEvent,
  removeParticipantFromEvent,
} from "@/lib/admin-write.functions";
import {
  archiveEvent,
  uploadParticipantPhoto,
  uploadParticipantCard,
  deleteParticipantCard,
  type CardSide,
} from "@/lib/media.functions";
import { encodeUploadImageVariants } from "@/lib/image-encode";
import { CardBulkUpload } from "@/components/card-bulk-upload";
import { UniversalCardBack } from "@/components/universal-card-back";
import { SecretCardsPanel } from "@/components/secret-cards-panel";
import { MemberCodesPanel, AwardsAdminPanel } from "@/components/member-admin-panel";
import { AdminSection } from "@/components/admin-section";
import { useEventPhotoUrls, useEventCardUrls } from "@/hooks/use-photo-urls";
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
  IdCard,
  Trash2,
  UserPlus,
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
  const admin = useAdminSession();
  const isAdmin = !!event?.id && admin?.eventId === event.id;

  if (!event || !event.id) {
    return <div className="mx-auto max-w-md p-6 text-sm text-muted-foreground">Loading…</div>;
  }

  return isAdmin ? (
    <TimingConsole />
  ) : (
    <PinGate eventId={event.id} eventName={event.name ?? "Combine"} />
  );
}

// ---------------- PIN GATE ----------------
function PinGate({ eventId, eventName }: { eventId: string; eventName: string }) {
  const verifyFn = useServerFn(verifyEventPin);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);

  async function attempt(value: string) {
    setBusy(true);
    try {
      const res = await verifyFn({ data: { eventId, pin: value } });
      if (!res.ok) {
        toast.error("Incorrect PIN");
        setPin("");
        return;
      }
      setAdminToken(res.token);
      toast.success("Admin unlocked");
    } catch {
      toast.error("Could not verify PIN");
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!pin || busy) return;
    await attempt(pin);
  }

  return (
    <div className="mx-auto grid min-h-[60vh] max-w-md place-items-center px-4 py-10">
      <Card className="hud-bezel w-full border-white/10">
        <CardContent className="p-5 sm:p-6">
          <div className="mb-4">
            <div className="flex items-center gap-2 text-primary">
              <LockKeyhole className="h-4 w-4" />
              <span className="font-display text-[10px] font-bold uppercase tracking-[0.3em]">
                Console
              </span>
            </div>
            <h1 className="mt-1 font-display text-2xl font-black uppercase leading-none">
              Admin Access
            </h1>
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
              maxLength={4}
              value={pin}
              onChange={(e) => {
                const next = e.target.value.replace(/\D/g, "").slice(0, 4);
                setPin(next);
                if (next.length === 4 && !busy) void attempt(next);
              }}
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
    () =>
      (bundle?.stations ?? [])
        .filter((s) => s.active)
        .sort((a, b) => a.station_order - b.station_order),
    [bundle],
  );

  const currentEp = run ? participants.find((p) => p.participant_id === run.participantId) : null;

  const paused = run?.status === "paused";
  const finished = run?.status === "finished";
  const elapsed = run ? computeElapsedMs(run, performance.now()) : 0;

  const usedStationIds = new Set(run?.splits.map((s) => s.stationId) ?? []);

  async function signOut() {
    clearAdminToken();
    await qc.invalidateQueries();
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
        pauses: [...run.pauses, { pausedAt: performance.now(), resumedAt: null }],
      });
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
    const raw_time_ms = computeElapsedMs(
      { ...run, status: "finished", finishedAtPerf },
      finishedAtPerf,
    );
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
            <span className="font-display text-[10px] font-bold uppercase tracking-[0.3em]">
              Console
            </span>
            <Badge variant="secondary" className="ml-1 h-4 px-1.5 text-[9px] uppercase">
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
              <span className="font-display text-[10px] font-bold uppercase tracking-[0.3em]">
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
        />
      ) : (
        <Card className={"hud-bezel " + (paused ? "border-warn/60" : "border-primary/50 hud-glow")}>
          <CardContent className="p-4 sm:p-5">
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
                  className="h-12 flex-1 sm:h-10 sm:min-w-28 sm:flex-none"
                >
                  <Flag className="mr-1.5 h-4 w-4" /> Finish
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
                <h3 className="font-display text-sm font-bold uppercase tracking-widest text-muted-foreground">
                  Stations & Splits
                </h3>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={undoLastSplit}
                  disabled={run.splits.length === 0}
                >
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
                          onClick={() =>
                            addPenalty(st.id, st.penalty_amount_ms, `${st.name} penalty`)
                          }
                          disabled={finished}
                          className="min-h-9 rounded-md border border-warn/30 bg-warn/10 py-1 text-[10px] font-bold uppercase tracking-widest text-warn hover:bg-warn/20 disabled:opacity-50 sm:min-h-0"
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
                <h3 className="mb-1 font-display text-xs font-bold uppercase tracking-widest text-muted-foreground">
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
      <CardContent className="p-4 sm:p-5">
        <h2 className="mb-3 font-display text-xl font-black uppercase">Send next athlete</h2>
        <div className="max-h-[55vh] overflow-auto rounded border border-white/5 divide-y divide-white/5 sm:max-h-72">
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
                {sel && <Badge className="bg-primary text-primary-foreground">Next</Badge>}
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
// ---------------- EVENT OPS: QR / PHOTOS / ARCHIVE ----------------
function EventOpsPanel({ eventId, eventName }: { eventId: string; eventName: string }) {
  const { event, bundle } = useEventBundle();
  const awardsLocked = event?.awards_locked;
  const photos = useEventPhotoUrls(eventId);
  const cards = useEventCardUrls(eventId);
  const qc = useQueryClient();
  const uploadFn = useServerFn(uploadParticipantPhoto);
  const uploadCardFn = useServerFn(uploadParticipantCard);
  const deleteCardFn = useServerFn(deleteParticipantCard);
  const archiveFn = useServerFn(archiveEvent);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [uploadingCardId, setUploadingCardId] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);

  const liveUrl = typeof window !== "undefined" ? `${window.location.origin}/live` : "/live";
  const tvUrl = typeof window !== "undefined" ? `${window.location.origin}/tv` : "/tv";

  useEffect(() => {
    let cancelled = false;
    import("qrcode").then(({ default: QR }) => {
      QR.toDataURL(liveUrl, {
        margin: 1,
        width: 240,
        color: { dark: "#38bdf8", light: "#0b1220" },
      }).then((d) => {
        if (!cancelled) setQrDataUrl(d);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [liveUrl]);

  async function onPickPhoto(epId: string, file: File) {
    setUploadingId(epId);
    try {
      const dataUrls = await encodeUploadImageVariants(file);
      await uploadFn({ data: { eventId, eventParticipantId: epId, dataUrls } });
      await qc.invalidateQueries({ queryKey: ["photo-urls", eventId] });
      toast.success("Photo uploaded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploadingId(null);
    }
  }

  async function onPickCard(epId: string, side: CardSide, file: File) {
    setUploadingCardId(`${epId}:${side}`);
    try {
      const dataUrls = await encodeUploadImageVariants(file);
      await uploadCardFn({ data: { eventId, eventParticipantId: epId, side, dataUrls } });
      await qc.invalidateQueries({ queryKey: ["card-urls", eventId] });
      toast.success(`Card ${side} uploaded`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploadingCardId(null);
    }
  }

  async function onRemoveCard(epId: string, side: CardSide) {
    if (!confirm(`Remove this player's ${side} card image?`)) return;
    try {
      await deleteCardFn({ data: { eventId, eventParticipantId: epId, side } });
      await qc.invalidateQueries({ queryKey: ["card-urls", eventId] });
      toast.success("Card removed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Remove failed");
    }
  }

  async function onArchive() {
    if (!confirm(`Archive "${eventName}" as a permanent recap?`)) return;
    setArchiving(true);
    try {
      const res = await archiveFn({ data: { eventId } });
      toast.success(`Archived: /recap/${res.slug}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Archive failed");
    } finally {
      setArchiving(false);
    }
  }

  const bulkTargets = (bundle?.participants ?? []).map((p) => ({
    id: p.id,
    name: p.participant?.name ?? "Unknown",
    nickname: p.participant?.nickname ?? null,
  }));

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="md:col-span-2">
        <CardBulkUpload eventId={eventId} targets={bulkTargets} />
      </div>

      <div className="md:col-span-2">
        <UniversalCardBack eventId={eventId} />
      </div>

      {/* No eventId: these rows are league-wide, and the panel resolves the
          current combine server-side to authorize. */}
      <div className="md:col-span-2">
        <SecretCardsPanel />
      </div>

      <MemberCodesPanel eventId={eventId} />
      <AwardsAdminPanel eventId={eventId} locked={!!awardsLocked} />

      <div className="md:col-span-2">
        <AddPlayerPanel eventId={eventId} />
      </div>

      <AdminSection
        icon={<QrCode className="h-4 w-4 shrink-0" />}
        title="Spectator Access"
        defaultOpen
      >
        {qrDataUrl && (
          <img
            src={qrDataUrl}
            alt="QR code to live spectator view"
            className="mx-auto h-auto w-full max-w-[240px] rounded-lg border border-primary/30"
            width={240}
            height={240}
          />
        )}
        <div className="mt-3 space-y-1 text-center text-xs">
          <a
            href={liveUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 break-all text-primary hover:underline"
          >
            <ExternalLink className="h-3 w-3 shrink-0" /> {liveUrl}
          </a>
          <div>
            <a
              href={tvUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 break-all text-primary/80 hover:underline"
            >
              <ExternalLink className="h-3 w-3 shrink-0" /> TV big-screen: /tv
            </a>
          </div>
        </div>
      </AdminSection>

      <AdminSection icon={<Camera className="h-4 w-4 shrink-0" />} title="Participant Photos">
        <div className="mb-3">
          <Button
            size="sm"
            variant="secondary"
            onClick={onArchive}
            disabled={archiving}
            className="min-h-11 w-full sm:min-h-0 sm:w-auto"
          >
            <Archive className="mr-1.5 h-3.5 w-3.5" />
            {archiving ? "Archiving…" : "Archive Event"}
          </Button>
        </div>
        {/* Uncapped on phones — the section already collapses, so a nested
            scroll box here would just trap touch scrolling. */}
        <div className="space-y-1 overflow-visible pr-1 sm:max-h-72 sm:overflow-auto">
          {(bundle?.participants ?? []).map((p) => (
            <div
              key={p.id}
              className="flex flex-wrap items-center gap-2 rounded-md border border-white/5 bg-white/[0.02] px-2 py-1.5"
            >
              <div className="flex min-w-0 flex-1 basis-full items-center gap-2 sm:basis-auto">
                <ParticipantAvatar
                  name={p.participant?.name ?? "?"}
                  photoUrl={photos.data?.[p.id] ?? p.participant?.profile_image_url ?? null}
                  size={36}
                />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold uppercase">
                  {p.participant?.name}
                </span>
              </div>

              {/* Upload controls take a full second line on phones. */}
              <div className="flex w-full items-center gap-1.5 sm:w-auto">
                <label className="flex min-h-11 flex-1 cursor-pointer items-center justify-center rounded border border-white/10 px-3 text-[10px] font-bold uppercase tracking-widest text-primary/80 hover:border-primary/60 hover:text-primary sm:min-h-0 sm:flex-none sm:px-2 sm:py-1">
                  <Camera className="mr-1 inline h-3 w-3 shrink-0" />
                  {uploadingId === p.id ? "…" : "Photo"}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) onPickPhoto(p.id, f);
                      e.target.value = "";
                    }}
                  />
                </label>
                {(["front", "back"] as const).map((side) => {
                  const has = !!cards.data?.[p.id]?.[side];
                  const busy = uploadingCardId === `${p.id}:${side}`;
                  return (
                    <span key={side} className="flex flex-1 items-center sm:flex-none">
                      <label className="flex min-h-11 flex-1 cursor-pointer items-center justify-center rounded border border-primary/30 bg-primary/10 px-3 text-[10px] font-bold uppercase tracking-widest text-primary hover:bg-primary/20 sm:min-h-0 sm:flex-none sm:px-2 sm:py-1">
                        <IdCard className="mr-1 inline h-3 w-3 shrink-0" />
                        {busy ? "…" : has ? `${side} ✓` : side}
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) onPickCard(p.id, side, f);
                            e.target.value = "";
                          }}
                        />
                      </label>
                      {has && (
                        <button
                          onClick={() => onRemoveCard(p.id, side)}
                          className="shrink-0 rounded p-2.5 text-muted-foreground hover:text-destructive sm:p-1"
                          aria-label={`Remove ${side} card`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </AdminSection>
    </div>
  );
}

function AddPlayerPanel({ eventId }: { eventId: string }) {
  const qc = useQueryClient();
  const upsertFn = useServerFn(upsertParticipant);
  const addFn = useServerFn(addParticipantToEvent);
  const removeFn = useServerFn(removeParticipantFromEvent);
  const { bundle } = useEventBundle();
  const [name, setName] = useState("");
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState(false);

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const p = await upsertFn({
        data: {
          eventId,
          name: trimmed,
          nickname: nickname.trim() || null,
        },
      });
      await addFn({ data: { eventId, participantId: p.id } });
      await qc.invalidateQueries();
      setName("");
      setNickname("");
      toast.success(`Added ${trimmed}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add player");
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(epId: string, playerName: string) {
    if (!confirm(`Remove ${playerName} from this event?`)) return;
    try {
      await removeFn({ data: { eventId, eventParticipantId: epId } });
      await qc.invalidateQueries();
      toast.success(`Removed ${playerName}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove player");
    }
  }

  const roster = bundle?.participants ?? [];

  return (
    <AdminSection
      icon={<UserPlus className="h-4 w-4 shrink-0" />}
      title="Add Player"
      meta={`${roster.length} on roster`}
    >
      <form onSubmit={onAdd} className="space-y-2">
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <Label htmlFor="new-player-name" className="text-[10px] uppercase tracking-widest">
              Name
            </Label>
            <Input
              id="new-player-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full name"
              maxLength={80}
              autoComplete="off"
            />
          </div>
          <div>
            <Label htmlFor="new-player-nick" className="text-[10px] uppercase tracking-widest">
              Nickname (optional)
            </Label>
            <Input
              id="new-player-nick"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="Nickname"
              maxLength={80}
              autoComplete="off"
            />
          </div>
        </div>
        <Button
          type="submit"
          size="sm"
          disabled={busy || !name.trim()}
          className="min-h-11 w-full sm:min-h-0"
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          {busy ? "Adding…" : "Add to event"}
        </Button>
      </form>

      {roster.length > 0 && (
        <ul className="mt-3 max-h-56 space-y-0.5 overflow-auto pr-1">
          {roster.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between gap-2 rounded px-1 py-1 text-xs"
            >
              <span className="truncate uppercase">{p.participant?.name}</span>
              <button
                onClick={() => onRemove(p.id, p.participant?.name ?? "player")}
                className="shrink-0 rounded p-2 text-muted-foreground hover:text-destructive"
                aria-label="Remove player"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </AdminSection>
  );
}
