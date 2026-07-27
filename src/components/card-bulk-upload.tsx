import { useCallback, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Upload, X, CheckCircle2, AlertTriangle } from "lucide-react";
import { uploadParticipantCardsBulk, type CardSide } from "@/lib/media.functions";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Server cap is 12,000,000 chars of base64 per card (see media.functions.ts).
 * Base64 expands raw bytes by ~4/3, so cap raw file size at ~8.9 MB to stay
 * under the encoded limit (with headroom for the data URL prefix). Bulk
 * requests validate the whole batch atomically, so one oversize file would
 * reject the entire round trip instead of failing per-item.
 */
const MAX_BYTES = 8_800_000;
const ACCEPT = ["image/png", "image/jpeg", "image/webp"];

type Candidate = {
  id: string;
  file: File;
  previewUrl: string;
  eventParticipantId: string | null;
  side: CardSide;
  /** True when the filename matched a player automatically. */
  autoMatched: boolean;
  oversize: boolean;
};

export type BulkTarget = { id: string; name: string; nickname?: string | null };

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Filenames like "josh-eden-back.png" or "herr_b.jpg" declare which face they are. */
function detectSide(normalized: string): { side: CardSide; rest: string } {
  const tokens = normalized.split(" ").filter(Boolean);
  const last = tokens[tokens.length - 1];
  if (last === "back" || last === "b" || last === "rear") {
    return { side: "back", rest: tokens.slice(0, -1).join(" ") };
  }
  if (last === "front" || last === "f") {
    return { side: "front", rest: tokens.slice(0, -1).join(" ") };
  }
  return { side: "front", rest: normalized };
}

/**
 * Score a filename against a player. Token overlap rather than exact equality so
 * "DSC_ryan-marquart-final" still lands on Ryan Marquart.
 */
function scoreMatch(fileTokens: string[], target: BulkTarget): number {
  const nameTokens = normalize(target.name).split(" ").filter(Boolean);
  const nickTokens = target.nickname ? normalize(target.nickname).split(" ").filter(Boolean) : [];
  const candidates = [...nameTokens, ...nickTokens];
  if (candidates.length === 0) return 0;

  let score = 0;
  for (const token of candidates) {
    if (token.length < 2) continue;
    if (fileTokens.includes(token)) score += token.length >= 4 ? 2 : 1;
    else if (fileTokens.some((f) => f.length >= 4 && (f.includes(token) || token.includes(f)))) {
      score += 1;
    }
  }
  // Both parts of a full name matching is a much stronger signal than one.
  const surname = nameTokens[nameTokens.length - 1];
  if (nameTokens.length > 1 && surname && fileTokens.includes(surname)) score += 2;
  return score;
}

function bestMatch(filename: string, targets: BulkTarget[]) {
  const { side, rest } = detectSide(normalize(filename));
  const tokens = rest.split(" ").filter(Boolean);
  let best: { id: string; score: number } | null = null;
  for (const t of targets) {
    const score = scoreMatch(tokens, t);
    if (score > 0 && (!best || score > best.score)) best = { id: t.id, score };
  }
  // Require a real signal — a single weak token match is a guess, not a match.
  return { side, id: best && best.score >= 2 ? best.id : null };
}

export function CardBulkUpload({ eventId, targets }: { eventId: string; targets: BulkTarget[] }) {
  const qc = useQueryClient();
  const bulkFn = useServerFn(uploadParticipantCardsBulk);
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Candidate[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const next: Candidate[] = [];
      for (const file of Array.from(files)) {
        // Some browsers report an empty MIME type for dragged files, so fall
        // back to the extension rather than silently dropping the file.
        if (!ACCEPT.includes(file.type) && !/\.(png|jpe?g|webp)$/i.test(file.name)) continue;
        const { side, id } = bestMatch(file.name, targets);
        next.push({
          id: `${file.name}-${file.size}-${file.lastModified}`,
          file,
          previewUrl: URL.createObjectURL(file),
          eventParticipantId: id,
          side,
          autoMatched: !!id,
          oversize: file.size > MAX_BYTES,
        });
      }
      if (next.length === 0) {
        toast.error("No PNG, JPEG, or WebP files found");
        return;
      }
      setItems((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        const fresh = next.filter((n) => !seen.has(n.id));
        // Release preview URLs for files that were already staged.
        next.filter((n) => seen.has(n.id)).forEach((n) => URL.revokeObjectURL(n.previewUrl));
        return [...prev, ...fresh];
      });
    },
    [targets],
  );

  const removeItem = useCallback((id: string) => {
    setItems((prev) => {
      const gone = prev.find((p) => p.id === id);
      if (gone) URL.revokeObjectURL(gone.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  }, []);

  function clearAll() {
    items.forEach((i) => URL.revokeObjectURL(i.previewUrl));
    setItems([]);
  }

  const ready = useMemo(() => items.filter((i) => i.eventParticipantId && !i.oversize), [items]);
  const unmatched = items.length - ready.length;

  async function onUpload() {
    if (ready.length === 0) return;
    setBusy(true);
    try {
      const payload = await Promise.all(
        ready.map(
          (i) =>
            new Promise<{ eventParticipantId: string; side: CardSide; dataUrl: string }>(
              (res, rej) => {
                const r = new FileReader();
                r.onload = () =>
                  res({
                    eventParticipantId: i.eventParticipantId!,
                    side: i.side,
                    dataUrl: r.result as string,
                  });
                r.onerror = rej;
                r.readAsDataURL(i.file);
              },
            ),
        ),
      );
      const res = await bulkFn({ data: { eventId, items: payload } });
      await qc.invalidateQueries({ queryKey: ["card-urls", eventId] });
      const failed = res.results.filter((r) => !r.ok);
      if (failed.length === 0) {
        toast.success(`Uploaded ${res.results.length} card${res.results.length === 1 ? "" : "s"}`);
        clearAll();
      } else {
        toast.error(`${failed.length} of ${res.results.length} failed: ${failed[0]?.error ?? ""}`);
        // Keep only the failures on screen so they can be retried.
        const failedKeys = new Set(failed.map((f) => `${f.eventParticipantId}:${f.side}`));
        setItems((prev) =>
          prev.filter(
            (p) =>
              !p.eventParticipantId ||
              p.oversize ||
              failedKeys.has(`${p.eventParticipantId}:${p.side}`),
          ),
        );
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Bulk upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="hud-bezel border-primary/20">
      <CardContent className="p-5">
        <div className="mb-3 flex items-center gap-2 text-primary">
          <Upload className="h-4 w-4" />
          <h2 className="font-display text-sm font-black uppercase tracking-[0.3em]">
            Bulk Card Upload
          </h2>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            addFiles(e.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          className={cn(
            "cursor-pointer rounded-lg border border-dashed p-6 text-center transition-colors",
            dragging
              ? "border-primary bg-primary/10"
              : "border-white/15 hover:border-primary/50 hover:bg-white/[0.02]",
          )}
        >
          <p className="font-display text-sm font-bold uppercase tracking-widest text-foreground">
            Drop card images here
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Names are matched automatically. Add <code>-front</code> or <code>-back</code> to a
            filename to set the side.
          </p>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {items.length > 0 && (
          <>
            <div className="mt-4 max-h-80 space-y-1.5 overflow-auto pr-1">
              {items.map((item) => (
                <div
                  key={item.id}
                  className={cn(
                    "flex items-center gap-2 rounded-md border px-2 py-1.5",
                    item.oversize
                      ? "border-destructive/40 bg-destructive/5"
                      : item.eventParticipantId
                        ? "border-white/5 bg-white/[0.02]"
                        : "border-warn/40 bg-warn/5",
                  )}
                >
                  <img
                    src={item.previewUrl}
                    alt=""
                    className="h-11 w-8 shrink-0 rounded border border-white/10 object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[11px] text-muted-foreground">
                      {item.file.name}
                    </div>
                    {item.oversize ? (
                      <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-destructive">
                        <AlertTriangle className="h-3 w-3" /> Over 12 MB
                      </div>
                    ) : (
                      <select
                        value={item.eventParticipantId ?? ""}
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((p) =>
                              p.id === item.id
                                ? { ...p, eventParticipantId: e.target.value || null }
                                : p,
                            ),
                          )
                        }
                        className="w-full rounded border border-white/10 bg-transparent px-1 py-0.5 text-xs font-semibold uppercase text-foreground"
                      >
                        <option value="">— unmatched —</option>
                        {targets.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  <div className="flex shrink-0 overflow-hidden rounded border border-white/10">
                    {(["front", "back"] as const).map((side) => (
                      <button
                        key={side}
                        onClick={() =>
                          setItems((prev) =>
                            prev.map((p) => (p.id === item.id ? { ...p, side } : p)),
                          )
                        }
                        className={cn(
                          "px-2 py-1 text-[9px] font-bold uppercase tracking-widest transition-colors",
                          item.side === side
                            ? "bg-primary/20 text-primary"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {side}
                      </button>
                    ))}
                  </div>

                  {item.autoMatched && !item.oversize && (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary/70" />
                  )}
                  <button
                    onClick={() => removeItem(item.id)}
                    className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive"
                    aria-label={`Remove ${item.file.name}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>

            <div className="mt-3 flex items-center justify-between gap-2">
              <div className="text-[11px] text-muted-foreground">
                {ready.length} ready
                {unmatched > 0 && <span className="text-warn"> · {unmatched} need attention</span>}
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={clearAll} disabled={busy}>
                  Clear
                </Button>
                <Button size="sm" onClick={onUpload} disabled={busy || ready.length === 0}>
                  {busy ? "Uploading…" : `Upload ${ready.length}`}
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
