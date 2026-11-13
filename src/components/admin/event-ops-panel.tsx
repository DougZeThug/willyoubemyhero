import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
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
import { DustAdminPanel } from "@/components/dust-admin-panel";
import { NavRowsPanel } from "@/components/nav-rows-panel";
import { OwnershipAuditPanel } from "@/components/ownership-audit-panel";
import { StationsPanel } from "@/components/stations-panel";
import { ResultsAdminPanel } from "@/components/results-admin-panel";
import { AdminSection } from "@/components/admin-section";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { RosterPanel } from "@/components/admin/roster-panel";
import { cardUrlsKey, photoUrlsKey } from "@/lib/query-keys";
import { dustLive } from "@/lib/dust";
import { navHidden } from "@/lib/nav";
import { useEventPhotoUrls, useEventCardUrls } from "@/hooks/use-photo-urls";
import { useEventBundle } from "@/hooks/use-event-bundle";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ParticipantAvatar } from "@/components/participant-avatar";
import { QrCode, Camera, Archive, ExternalLink, IdCard, Trash2, Wand2 } from "lucide-react";
import { errorMessage } from "@/lib/errors";

export function EventOpsPanel({ eventId, eventName }: { eventId: string; eventName: string }) {
  const { event, bundle } = useEventBundle();
  const awardsLocked = event?.awards_locked;
  const dustOn = dustLive(event);
  const navHiddenRows = navHidden(event);
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
  const photoUpload = useAdminAction();
  const cardUpload = useAdminAction();
  const cardRemoval = useAdminAction();
  const archive = useAdminAction();
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

  function onPickPhoto(epId: string, file: File) {
    return photoUpload.run(
      "Upload failed",
      async () => {
        const dataUrls = await encodeUploadImageVariants(file);
        await uploadFn({ data: { eventId, eventParticipantId: epId, dataUrls } });
        await qc.invalidateQueries({ queryKey: photoUrlsKey(eventId) });
        return "Photo uploaded";
      },
      epId,
    );
  }

  function onPickCard(epId: string, side: CardSide, file: File) {
    return cardUpload.run(
      "Upload failed",
      async () => {
        const dataUrls = await encodeUploadImageVariants(file);
        await uploadCardFn({ data: { eventId, eventParticipantId: epId, side, dataUrls } });
        await qc.invalidateQueries({ queryKey: cardUrlsKey(eventId) });
        return `Card ${side} uploaded`;
      },
      `${epId}:${side}`,
    );
  }

  function onRemoveCard(epId: string, side: CardSide) {
    if (!confirm(`Remove this player's ${side} card image?`)) return;
    return cardRemoval.run("Remove failed", async () => {
      await deleteCardFn({ data: { eventId, eventParticipantId: epId, side } });
      await qc.invalidateQueries({ queryKey: cardUrlsKey(eventId) });
      return "Card removed";
    });
  }

  function onArchive() {
    if (!confirm(`Archive "${eventName}" as a permanent recap?`)) return;
    return archive.run("Archive failed", async () => {
      const res = await archiveFn({ data: { eventId } });
      return `Archived: /recap/${res.slug}`;
    });
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
                  // What these variants were encoded from, so the write can
                  // tell whether newer art has landed on the row since.
                  source: need.path,
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
        qc.invalidateQueries({ queryKey: photoUrlsKey(eventId) }),
        qc.invalidateQueries({ queryKey: cardUrlsKey(eventId) }),
      ]);
      setRegenState({ running: false, done, total: needs.length, failed });
      if (failed === 0) {
        toast.success(`Regenerated ${done} image${done === 1 ? "" : "s"}.`);
      } else {
        toast.error(`Regenerated ${done}, ${failed} failed.`);
      }
    } catch (e) {
      setRegenState({ running: false, done: 0, total: 0, failed: 0 });
      toast.error(errorMessage(e, "Regeneration failed"));
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
        <SecretCardsPanel />
      </div>

      <div className="md:col-span-2">
        <CardBulkUpload eventId={eventId} targets={bulkTargets} />
      </div>

      <div className="md:col-span-2">
        <UniversalCardBack eventId={eventId} />
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
      <AwardsAdminPanel eventId={eventId} locked={Boolean(awardsLocked)} />
      <CardGrantPanel eventId={eventId} />
      <DustAdminPanel eventId={eventId} enabled={dustOn} />
      {/* Beside the dust switch on purpose: the shop row's reason line points
          straight back at it. */}
      <NavRowsPanel eventId={eventId} hidden={navHiddenRows} dustOn={dustOn} />
      <OwnershipAuditPanel eventId={eventId} />
      <StationsPanel eventId={eventId} />
      <ResultsAdminPanel eventId={eventId} />

      <div className="md:col-span-2">
        <RosterPanel eventId={eventId} />
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
            className="inline-flex min-h-11 items-center gap-1 break-all text-primary hover:underline pointer-fine:min-h-0"
          >
            <ExternalLink className="h-3 w-3 shrink-0" /> {liveUrl}
          </a>
          <div>
            <a
              href={tvUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center gap-1 break-all text-primary/80 hover:underline pointer-fine:min-h-0"
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
            disabled={archive.busy}
            className="min-h-11 w-full sm:min-h-0 sm:w-auto"
          >
            <Archive className="mr-1.5 h-3.5 w-3.5" />
            {archive.busy ? "Archiving…" : "Archive Event"}
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
              <span className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
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
                <label className="flex min-h-11 flex-1 cursor-pointer items-center justify-center rounded border border-border-strong px-3 text-label font-bold uppercase tracking-[0.08em] text-primary/80 hover:border-primary/60 hover:text-primary sm:min-h-0 sm:flex-none sm:px-2 sm:py-1">
                  <Camera className="mr-1 inline h-3 w-3 shrink-0" />
                  {photoUpload.busyKey === p.id ? "…" : "Photo"}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) onPickPhoto(p.id, file);
                      e.target.value = "";
                    }}
                  />
                </label>
                {(["front", "back"] as const).map((side) => {
                  const has = Boolean(cards.data?.[p.id]?.[side]);
                  const busy = cardUpload.busyKey === `${p.id}:${side}`;
                  return (
                    <span key={side} className="flex flex-1 items-center sm:flex-none">
                      <label className="flex min-h-11 flex-1 cursor-pointer items-center justify-center rounded border border-primary/30 bg-primary/10 px-3 text-label font-bold uppercase tracking-[0.08em] text-primary hover:bg-primary/20 sm:min-h-0 sm:flex-none sm:px-2 sm:py-1">
                        <IdCard className="mr-1 inline h-3 w-3 shrink-0" />
                        {busy ? "…" : has ? `${side} ✓` : side}
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) onPickCard(p.id, side, file);
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
