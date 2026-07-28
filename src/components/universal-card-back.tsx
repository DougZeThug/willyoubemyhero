import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Layers, Trash2 } from "lucide-react";
import { uploadEventCardBack, deleteEventCardBack, urlFromSet } from "@/lib/media.functions";
import { useEventCardBack } from "@/hooks/use-photo-urls";
import { encodeUploadImageVariants } from "@/lib/image-encode";
import { AdminSection } from "@/components/admin-section";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Matches the per-card cap in media.functions.ts (12M base64 chars ≈ 8.8 MB raw). */
const MAX_BYTES = 8_800_000;
const ACCEPT = ["image/png", "image/jpeg", "image/webp"];

/**
 * One image, uploaded once, used as the back of every player card in the event.
 * A player who has their own back art uploaded keeps it — the resolution order
 * lives in getEventCardUrls.
 */
export function UniversalCardBack({ eventId }: { eventId: string }) {
  const qc = useQueryClient();
  const uploadFn = useServerFn(uploadEventCardBack);
  const deleteFn = useServerFn(deleteEventCardBack);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  // Shared with the sealed pack on /players/pack, which wears this same image —
  // so an upload here refreshes a pack already open on somebody else's phone.
  const back = useEventCardBack(eventId);

  async function onPick(file: File) {
    if (!ACCEPT.includes(file.type) && !/\.(png|jpe?g|webp)$/i.test(file.name)) {
      toast.error("Card back must be a PNG, JPEG, or WebP");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("Card back is over 8.8 MB");
      return;
    }
    setBusy(true);
    try {
      const dataUrls = await encodeUploadImageVariants(file);
      await uploadFn({ data: { eventId, dataUrls } });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["event-card-back", eventId] }),
        // Every player's back resolves through this query.
        qc.invalidateQueries({ queryKey: ["card-urls", eventId] }),
      ]);
      toast.success("Universal card back set for every player");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function onRemove() {
    if (!confirm("Remove the universal card back? Cards fall back to the generated stats back."))
      return;
    setBusy(true);
    try {
      await deleteFn({ data: { eventId } });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["event-card-back", eventId] }),
        qc.invalidateQueries({ queryKey: ["card-urls", eventId] }),
      ]);
      toast.success("Universal card back removed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Remove failed");
    } finally {
      setBusy(false);
    }
  }

  const url = back.data?.url ?? null;

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
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const file = e.dataTransfer.files?.[0];
              if (file) void onPick(file);
            }}
            onClick={() => !busy && inputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                inputRef.current?.click();
              }
            }}
            className={cn(
              "cursor-pointer rounded-lg border border-dashed p-5 text-center transition-colors",
              dragging
                ? "border-primary bg-primary/10"
                : "border-white/15 hover:border-primary/50 hover:bg-white/[0.02]",
              busy && "pointer-events-none opacity-60",
            )}
          >
            <p className="font-display text-sm font-bold uppercase tracking-widest text-foreground">
              {busy ? "Uploading…" : url ? "Replace card back" : "Upload card back"}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              One image, used as the back of every player&apos;s card. A player with their own back
              art uploaded keeps it.
            </p>
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onPick(file);
                e.target.value = "";
              }}
            />
          </div>

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
