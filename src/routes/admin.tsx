import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { verifyEventPin, startAdminSessionFromAccount } from "@/lib/admin.functions";
import { clearAdminToken, setAdminToken, useAdminSession } from "@/lib/admin-token";
import { useAuthUser } from "@/hooks/use-account";
import { setParticipantStatus, resetCombine } from "@/lib/admin-write.functions";
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
  getImagePathsNeedingVariants,
  writeImageVariants,
} from "@/lib/media.functions";
import type { CardSide } from "@/lib/media";
import { encodeUploadImageVariants } from "@/lib/image-encode";
import { CardBulkUpload } from "@/components/card-bulk-upload";
import { UniversalCardBack } from "@/components/universal-card-back";
import { SecretCardsPanel } from "@/components/secret-cards-panel";
import { CardPromptStudio } from "@/components/card-prompt-studio";
import { MemberCodesPanel, AwardsAdminPanel } from "@/components/member-admin-panel";
import { CardGrantPanel } from "@/components/card-grant-panel";
import { OwnershipAuditPanel } from "@/components/ownership-audit-panel";
import { StationsPanel } from "@/components/stations-panel";
import { ResultsAdminPanel } from "@/components/results-admin-panel";
import { AdminSection } from "@/components/admin-section";
import { useEventPhotoUrls, useEventCardUrls } from "@/hooks/use-photo-urls";
import { useEventBundle } from "@/hooks/use-event-bundle";
import { asFinishedRun, useFinishSave } from "@/hooks/use-finish-save";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ParticipantAvatar } from "@/components/participant-avatar";
import { BigTimer } from "@/components/big-timer";
import { formatTime, newClientKey } from "@/lib/format";
import {
  ACTIVE_RUN_VERSION,
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
  UserMinus,
  UserCheck,
  Radio,
  RotateCcw,
  Wand2,
} from "lucide-react";

import { currentAthlete, fieldSize } from "@/lib/current-athlete";
import { useRunConsole } from "@/hooks/use-run-console";

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
  // Accounts on the admin list skip the PIN entirely; the PIN stays as the
  // fallback for anyone signed out or not on the list.
  const { user, loading: authLoading } = useAuthUser();
  const [accountChecked, setAccountChecked] = useState(false);
  const triedFor = useRef<string | null>(null);

  useEffect(() => {
    if (isAdmin || authLoading) return;
    if (!user) {
      setAccountChecked(true);
      return;
    }
    if (triedFor.current === user.id) return;
    triedFor.current = user.id;
    void (async () => {
      try {
        const res = await startAdminSessionFromAccount({ data: undefined });
        if (res.ok) {
          setAdminToken(res.token);
          toast.success("Admin unlocked via your account");
        }
      } catch {
        /* fall through to the PIN gate */
      } finally {
        setAccountChecked(true);
      }
    })();
  }, [isAdmin, user, authLoading]);

  if (!event || !event.id) {
    return <div className="mx-auto max-w-md p-6 text-sm text-muted-foreground">Loading…</div>;
  }

  if (!isAdmin && (authLoading || !accountChecked)) {
    return (
      <div className="mx-auto max-w-md p-6 text-sm text-muted-foreground">Checking access…</div>
    );
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
        // A locked-out gate must not read as "wrong PIN" — the next CORRECT
        // entry fails too, and "incorrect" would send the commissioner hunting
        // for a PIN they already have.
        toast.error(
          res.reason === "too_many_attempts"
            ? "Too many tries — the gate is resting. Give it a few minutes."
            : "Incorrect PIN",
        );
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
  const qc = useQueryClient();
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
          onSetOnClock={setOnClock}
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
                  <div
                    className={
                      "text-xs font-bold uppercase tracking-[0.28em] " +
                      (finished ? "text-warn" : "text-muted-foreground")
                    }
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
  onSetOnClock,
}: {
  participants: NonNullable<ReturnType<typeof useEventBundle>["bundle"]>["participants"];
  selectedParticipantId: string;
  onSelect: (id: string) => void;
  onStart: () => void;
  onSetOnClock: (participantId: string | null) => void;
}) {
  const queued = participants.filter(
    (p) => p.participation_status !== "finished" && p.participation_status !== "scratched",
  );
  const slot = currentAthlete(participants);
  const nextUp = queued[0];
  useEffect(() => {
    if (!selectedParticipantId && nextUp) onSelect(nextUp.participant_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextUp?.participant_id]);

  return (
    <Card>
      <CardContent className="p-4 sm:p-5">
        <h2 className="mb-3 font-display text-xl font-black uppercase">Send next athlete</h2>
        <div className="mb-3 flex items-center gap-2 rounded-md border border-primary/20 bg-primary/[0.06] px-3 py-2">
          <Radio
            className={
              "h-4 w-4 shrink-0 " +
              (slot.onClock ? "animate-pulse text-primary" : "text-muted-foreground")
            }
          />
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-[0.28em] text-muted-foreground">
              {slot.onClock ? "On the clock" : "Up next on the crowd screens"}
            </div>
            <div className="truncate text-sm font-semibold uppercase">
              {slot.athlete?.participant?.name ?? "Nobody left"}
            </div>
          </div>
          {slot.onClock ? (
            <Button size="sm" variant="ghost" onClick={() => onSetOnClock(null)}>
              Clear
            </Button>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              disabled={!selectedParticipantId}
              onClick={() => onSetOnClock(selectedParticipantId)}
            >
              On the clock
            </Button>
          )}
        </div>
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
  const scanVariantsFn = useServerFn(getImagePathsNeedingVariants);
  const writeVariantsFn = useServerFn(writeImageVariants);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [uploadingCardId, setUploadingCardId] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [regenState, setRegenState] = useState<{
    running: boolean;
    done: number;
    total: number;
    failed: number;
  }>({ running: false, done: 0, total: 0, failed: 0 });

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

  async function onRegenerateVariants() {
    setRegenState({ running: true, done: 0, total: 0, failed: 0 });
    try {
      const { needs } = await scanVariantsFn({ data: { eventId } });
      if (needs.length === 0) {
        toast.success("All images already have responsive variants.");
        setRegenState({ running: false, done: 0, total: 0, failed: 0 });
        return;
      }
      setRegenState({ running: true, done: 0, total: needs.length, failed: 0 });
      let done = 0;
      let failed = 0;
      // Process one at a time — canvas re-encoding on a phone is memory-heavy.
      for (const need of needs) {
        try {
          const res = await fetch(need.url);
          if (!res.ok) throw new Error(`fetch ${res.status}`);
          const blob = await res.blob();
          const filename = need.path.split("/").pop() ?? "image";
          const file = new File([blob], filename, { type: blob.type || "image/webp" });
          const dataUrls = await encodeUploadImageVariants(file);
          await writeVariantsFn({
            data: {
              eventId,
              updates: [
                {
                  id: need.id,
                  kind: need.kind as "photo" | "card_front" | "card_back" | "universal_back",
                  dataUrls,
                },
              ],
            },
          });
          done += 1;
        } catch (err) {
          failed += 1;
          console.error("Variant regeneration failed", need, err);
        }
        setRegenState({ running: true, done, total: needs.length, failed });
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["photo-urls", eventId] }),
        qc.invalidateQueries({ queryKey: ["card-urls", eventId] }),
      ]);
      setRegenState({ running: false, done, total: needs.length, failed });
      if (failed === 0) {
        toast.success(`Regenerated ${done} image${done === 1 ? "" : "s"}.`);
      } else {
        toast.error(`Regenerated ${done}, ${failed} failed.`);
      }
    } catch (e) {
      setRegenState({ running: false, done: 0, total: 0, failed: 0 });
      toast.error(e instanceof Error ? e.message : "Regeneration failed");
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

      <div className="md:col-span-2">
        <CardPromptStudio
          eventId={eventId}
          eventName={eventName}
          bundle={bundle}
          photoUrls={photos.data}
        />
      </div>

      <MemberCodesPanel eventId={eventId} />
      <AwardsAdminPanel eventId={eventId} locked={!!awardsLocked} />
      <CardGrantPanel eventId={eventId} />
      <OwnershipAuditPanel eventId={eventId} />
      <StationsPanel eventId={eventId} />
      <ResultsAdminPanel eventId={eventId} />

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
          <div className="mt-2 flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
            <Button
              size="sm"
              variant="secondary"
              onClick={onRegenerateVariants}
              disabled={regenState.running}
              className="min-h-11 w-full sm:min-h-0 sm:w-auto"
            >
              <Wand2 className="mr-1.5 h-3.5 w-3.5" />
              {regenState.running
                ? `Regenerating ${regenState.done}/${regenState.total}…`
                : "Regenerate image sizes"}
            </Button>
            {!regenState.running && regenState.total > 0 && (
              <span className="text-[11px] uppercase tracking-widest text-muted-foreground">
                {regenState.done}/{regenState.total} done
                {regenState.failed > 0 ? ` · ${regenState.failed} failed` : ""}
              </span>
            )}
          </div>
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
  const statusFn = useServerFn(setParticipantStatus);
  const resetFn = useServerFn(resetCombine);
  const { bundle } = useEventBundle();
  const [name, setName] = useState("");
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetting, setResetting] = useState(false);

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
      const res = await removeFn({ data: { eventId, eventParticipantId: epId } });
      await qc.invalidateQueries();
      // Deleting a roster row cascades away every copy of that card in the
      // league, so a packed player is scratched instead of deleted.
      toast.success(
        res.retained
          ? `${playerName} marked out — their cards stay in people's collections`
          : `Removed ${playerName}`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove player");
    }
  }

  /** In/out of this year's field. Out keeps the person, their cards and page. */
  async function toggleIn(epId: string, playerName: string, isIn: boolean) {
    try {
      await statusFn({
        data: { eventId, eventParticipantId: epId, status: isIn ? "scratched" : "waiting" },
      });
      await qc.invalidateQueries();
      toast.success(isIn ? `${playerName} is out` : `${playerName} is in`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update the roster");
    }
  }

  async function onReset() {
    if (
      !confirm(
        "Delete every recorded run for this combine, clear the timer on this phone and set everyone back to waiting?",
      )
    ) {
      return;
    }
    setResetting(true);
    try {
      const res = await resetFn({ data: { eventId } });
      // The stored run is what made a reset look like it "didn't take": the
      // server was clean but this phone kept timing the old athlete.
      await clearActiveRun();
      await qc.invalidateQueries();
      toast.success(`Combine reset — ${res.clearedRuns} run(s) cleared`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not reset the combine");
    } finally {
      setResetting(false);
    }
  }

  const roster = bundle?.participants ?? [];
  const inField = fieldSize(roster);

  return (
    <AdminSection
      icon={<UserPlus className="h-4 w-4 shrink-0" />}
      title="Combine Roster"
      meta={`${inField} in · ${roster.length - inField} out`}
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
        <ul className="mt-3 max-h-72 space-y-0.5 overflow-auto pr-1">
          {[...roster]
            .sort((a, b) => a.running_order - b.running_order)
            .map((p) => {
              const isIn = p.participation_status !== "scratched";
              const playerName = p.participant?.name ?? "player";
              return (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-2 rounded px-1 py-1 text-xs"
                >
                  <span
                    className={
                      "truncate uppercase " + (isIn ? "" : "text-muted-foreground line-through")
                    }
                  >
                    {playerName}
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <Button
                      size="sm"
                      variant={isIn ? "secondary" : "ghost"}
                      className="h-8 px-2 text-[10px] uppercase tracking-widest"
                      onClick={() => toggleIn(p.id, playerName, isIn)}
                    >
                      {isIn ? (
                        <>
                          <UserCheck className="mr-1 h-3.5 w-3.5" />
                          In
                        </>
                      ) : (
                        <>
                          <UserMinus className="mr-1 h-3.5 w-3.5" />
                          Out
                        </>
                      )}
                    </Button>
                    <button
                      onClick={() => onRemove(p.id, playerName)}
                      className="rounded p-2 text-muted-foreground hover:text-destructive"
                      aria-label={`Drop ${playerName} from the event`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </span>
                </li>
              );
            })}
        </ul>
      )}

      <Button
        variant="outline"
        size="sm"
        disabled={resetting}
        onClick={onReset}
        className="mt-3 min-h-11 w-full border-destructive/40 text-destructive hover:bg-destructive/10 sm:min-h-0"
      >
        <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
        {resetting ? "Resetting…" : "Reset combine"}
      </Button>
    </AdminSection>
  );
}
