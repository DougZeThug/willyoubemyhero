import { cardUrlsKey, eventCardBackKey } from "@/lib/query-keys";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Layers, Trash2 } from "lucide-react";
import { uploadEventCardBack, deleteEventCardBack } from "@/lib/media.functions";
import { urlFromSet } from "@/lib/media";
import { useEventCardBack } from "@/hooks/use-photo-urls";
import { encodeUploadImageVariants } from "@/lib/image-encode";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { AdminSection } from "@/components/admin-section";
import { Button } from "@/components/ui/button";
import { ImageDropZone } from "@/components/admin/image-drop-zone";
import { isUploadImage, MAX_IMAGE_BYTES, MAX_IMAGE_MB } from "@/components/admin/image-limits";

/**
 * One image, uploaded once, used as the back of every player card in the event.
 * A player who has their own back art uploaded keeps it — the resolution order
 * lives in getEventCardUrls.
 */
export function UniversalCardBack({ eventId }: { eventId: string }) {
  const qc = useQueryClient();
  const uploadFn = useServerFn(uploadEventCardBack);
  const deleteFn = useServerFn(deleteEventCardBack);
  const { busy, run } = useAdminAction();

  // Shared with the sealed pack on /players/pack, which wears this same image.
  // The invalidations below only reach this tab; a pack already open on somebody
  // else's phone is refreshed by useEventBundle, which invalidates the same two
  // keys when the events row this upload writes comes back down the channel.
  const back = useEventCardBack(eventId);

  async function onPick(file: File) {
    if (!isUploadImage(file)) {
      toast.error("Card back must be a PNG, JPEG, or WebP");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast.error(`Card back is over ${MAX_IMAGE_MB} MB`);
      return;
    }
    await run("Upload failed", async () => {
      const dataUrls = await encodeUploadImageVariants(file);
      await uploadFn({ data: { eventId, dataUrls } });
      await Promise.all([
        qc.invalidateQueries({ queryKey: eventCardBackKey(eventId) }),
        // Every player's back resolves through this query.
        qc.invalidateQueries({ queryKey: cardUrlsKey(eventId) }),
      ]);
      return "Universal card back set for every player";
    });
  }

  async function onRemove() {
    if (!confirm("Remove the universal card back? Cards fall back to the generated stats back."))
      return;
    await run("Remove failed", async () => {
      await deleteFn({ data: { eventId } });
      await Promise.all([
        qc.invalidateQueries({ queryKey: eventCardBackKey(eventId) }),
        qc.invalidateQueries({ queryKey: cardUrlsKey(eventId) }),
      ]);
      return "Universal card back removed";
    });
  }

  const url = urlFromSet(back.data?.urls);

  return (
    <AdminSection
      icon={<Layers className="h-4 w-4 shrink-0" />}
      title="Universal Card Back"
      meta={url ? "Set" : "Not set"}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        {url && (
          <img
            src={url}
            alt="Universal card back"
            className="w-24 shrink-0 self-center rounded-lg border border-white/15 object-cover sm:self-start"
          />
        )}

        <div className="min-w-0 flex-1">
          <ImageDropZone onFiles={(files) => void onPick(files[0])} busy={busy} className="p-5">
            <p className="font-display text-sm font-bold uppercase tracking-[0.08em] text-foreground">
              {busy ? "Uploading…" : url ? "Replace card back" : "Upload card back"}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              One image, used as the back of every player&apos;s card. A player with their own back
              art uploaded keeps it.
            </p>
          </ImageDropZone>

          {url && (
            <div className="mt-2 flex justify-end">
              <Button
                size="sm"
                variant="secondary"
                onClick={onRemove}
                disabled={busy}
                className="min-h-11 sm:min-h-0"
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Remove
              </Button>
            </div>
          )}
        </div>
      </div>
    </AdminSection>
  );
}
