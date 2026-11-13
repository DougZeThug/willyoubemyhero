import { useState, type Dispatch, type SetStateAction } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { UploadCloud, X } from "lucide-react";
import { createSecretCards } from "@/lib/secret-cards.functions";
import { encodeUploadImage, snapshotFile } from "@/lib/image-encode";
import { errorMessage } from "@/lib/errors";
import type { SecretCollection } from "@/lib/secret-cards";
import { plural } from "@/components/plural";
import { ImageDropZone } from "@/components/admin/image-drop-zone";
import { isUploadImage, MAX_IMAGE_BYTES, MAX_IMAGE_MB } from "@/components/admin/image-limits";
import type { useAdminAction } from "@/components/admin/use-admin-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const MAX_FLAVOUR = 240;

/**
 * The filename becomes the card's name.
 *
 * Borrowed from card-bulk-upload's `normalize`, for a reason that matters more
 * here than it looks: the alternative is twelve rounds of pick-file, wait, type a
 * name, type a joke, tap save, on a phone, the night before the combine. That
 * does not happen — cards six through twelve never get made and the set is thin
 * from day one. "gary-the-grill.webp" arriving as "Gary The Grill" turns twenty
 * minutes of thumb work into three.
 */
function nameFromFile(filename: string): string {
  const words = filename
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  return words
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ")
    .slice(0, 60);
}

export type Draft = {
  key: string;
  name: string;
  flavour: string;
  collection: string | null;
  file: File;
  previewUrl: string;
};

const SELECT_CLASS =
  "min-h-11 w-full min-w-0 rounded border border-border-strong bg-background px-1.5 text-base text-foreground pointer-fine:min-h-0 pointer-fine:text-xs";

/**
 * The drop zone and the staged cards waiting to be named and saved. The staged
 * list is owned by the panel (it also decides whether to say "no cards yet"), the
 * rest of the upload — the sticky set, reading the files, the save — lives here.
 */
export function SecretUploadDrafts({
  drafts,
  setDrafts,
  pickerSets,
  busy,
  run,
}: {
  drafts: Draft[];
  setDrafts: Dispatch<SetStateAction<Draft[]>>;
  pickerSets: SecretCollection[];
  busy: boolean;
  run: ReturnType<typeof useAdminAction>["run"];
}) {
  const qc = useQueryClient();
  const createFn = useServerFn(createSecretCards);
  // Which set new uploads are filed into. Sticky across drops, because the whole
  // point is dumping twelve WAGs in one go.
  const [uploadCollection, setUploadCollection] = useState<string | null>(null);

  // A hidden set stops being an option, but the ids held in state do not know
  // that: the sticky target and any staged draft would keep pointing at it while
  // every <select> fell back to showing "Unsorted", and the next batch would be
  // filed into a set the admin can no longer see as chosen. Clamped where it is
  // read rather than reset from an effect, so showing the set again restores the
  // choice instead of having quietly forgotten it.
  const activeIds = new Set(pickerSets.map((c) => c.id));
  const activeOrNull = (id: string | null) => (id && activeIds.has(id) ? id : null);
  const effectiveUpload = activeOrNull(uploadCollection);

  async function addFiles(files: File[]) {
    const next: Draft[] = [];
    for (const file of files) {
      if (!isUploadImage(file)) {
        toast.error(`${file.name}: card art must be a PNG, JPEG, or WebP`);
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        toast.error(`${file.name}: card art is over ${MAX_IMAGE_MB} MB`);
        continue;
      }
      // Read the bytes now, while the OS handle is still alive. One unreadable
      // file is rejected on its own so the rest of the batch stays staged.
      let staged: File;
      try {
        staged = await snapshotFile(file);
      } catch (e) {
        toast.error(errorMessage(e, `Couldn't read ${file.name}`));
        continue;
      }
      next.push({
        // Batch index alone repeats across drops, so the same file added twice
        // produced two drafts sharing a key — removing one wiped both.
        key: `${file.name}-${file.size}-${next.length}-${crypto.randomUUID()}`,
        name: nameFromFile(file.name),
        flavour: "",
        collection: effectiveUpload,
        file: staged,
        // Revoked in clearDrafts / removeDraft, and after a successful save.
        previewUrl: URL.createObjectURL(staged),
      });
    }
    if (next.length === 0) return;
    setDrafts((prev) => [...prev, ...next]);
  }

  function saveDrafts() {
    if (drafts.length === 0) return;
    if (drafts.some((d) => !d.name.trim())) {
      toast.error("Give the card a name");
      return;
    }
    return run("Upload failed", async () => {
      const encoded = await Promise.all(
        drafts.map(async (d) => ({
          name: d.name.trim(),
          // Wording stays optional and editable later. The art gets uploaded at
          // 11pm; the jokes get written on the train. A form that refuses to save
          // without wording guarantees seven unfinished cards.
          flavour: d.flavour.trim() || undefined,
          collection: activeOrNull(d.collection) ?? undefined,
          dataUrl: await encodeUploadImage(d.file),
        })),
      );
      const res = await createFn({ data: { cards: encoded } });
      const failed = res.results.filter((r) => !r.ok);
      await qc.invalidateQueries({ queryKey: ["secret-cards"] });
      clearDrafts();
      if (failed.length > 0) {
        toast.error(`${plural(failed.length, "card")} failed to upload`);
        return;
      }
      return `${res.results.length} added to the set`;
    });
  }

  function clearDrafts() {
    setDrafts((prev) => {
      prev.forEach((d) => URL.revokeObjectURL(d.previewUrl));
      return [];
    });
  }

  function removeDraft(key: string) {
    setDrafts((prev) => {
      prev.filter((d) => d.key === key).forEach((d) => URL.revokeObjectURL(d.previewUrl));
      return prev.filter((d) => d.key !== key);
    });
  }

  function patchDraft(index: number, patch: Partial<Draft>) {
    setDrafts((prev) => prev.map((x, j) => (index === j ? { ...x, ...patch } : x)));
  }

  return (
    <>
      <ImageDropZone
        onFiles={(files) => void addFiles(files)}
        multiple
        busy={busy}
        className="mt-3 p-5"
      >
        <UploadCloud className="mx-auto h-8 w-8 text-primary/70" aria-hidden />
        <p className="mt-2 font-display text-sm font-bold uppercase tracking-[0.08em] text-foreground">
          {busy ? "Uploading…" : <span className="max-sm:hidden">Drop card art here</span>}
          {!busy && <span className="sm:hidden">Add card art</span>}
        </p>
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
          The filename becomes the card&apos;s name. PNG, JPEG or WebP, up to {MAX_IMAGE_MB} MB.
          Portrait, roughly 5:7.
        </p>
        {/* The whole box is a drop target, but on a phone there is nothing to
            drop from — an explicit button is the affordance that reads as tappable. */}
        <Button
          size="sm"
          variant="secondary"
          type="button"
          className="mt-3 min-h-11 sm:min-h-0"
          disabled={busy}
        >
          Browse files
        </Button>
        {drafts.length > 0 && (
          <p className="mt-2 text-label font-bold uppercase tracking-[0.08em] text-primary">
            {drafts.length} staged
          </p>
        )}
        {/* Filed on the way in, so a batch of twelve is one pick rather than
            twelve. Stops the click from reaching the drop target behind it. */}
        <label
          className="mx-auto mt-3 flex max-w-xs items-center gap-2"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="shrink-0 text-label uppercase tracking-[0.08em] text-muted-foreground">
            Add to
          </span>
          <select
            value={effectiveUpload ?? ""}
            onChange={(e) => setUploadCollection(e.target.value || null)}
            className={SELECT_CLASS}
            aria-label="Set for new uploads"
          >
            <option value="">Unsorted</option>
            {pickerSets.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      </ImageDropZone>

      {drafts.length > 0 && (
        <div className="mt-3 space-y-2">
          {drafts.map((d, i) => (
            <div key={d.key} className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
              <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3">
                <img
                  src={d.previewUrl}
                  alt=""
                  className="aspect-[5/7] w-16 shrink-0 rounded-md border border-white/10 object-cover"
                />
                <div className="min-w-0 space-y-1.5">
                  <Input
                    value={d.name}
                    placeholder="Gary the Grill"
                    maxLength={60}
                    aria-label={`Name for ${d.file.name}`}
                    onChange={(e) => patchDraft(i, { name: e.target.value })}
                  />
                  <Input
                    value={d.flavour}
                    placeholder="Lit at 11am. Still going at 11pm."
                    maxLength={MAX_FLAVOUR}
                    aria-label={`Wording for ${d.file.name}`}
                    onChange={(e) => patchDraft(i, { flavour: e.target.value })}
                  />
                  <p className="text-meta leading-snug text-muted-foreground">
                    One line, printed on the back. This is the whole joke — keep it short.
                  </p>
                  <label className="flex items-center gap-2">
                    <span className="shrink-0 text-label uppercase tracking-[0.08em] text-muted-foreground">
                      Set
                    </span>
                    <select
                      value={activeOrNull(d.collection) ?? ""}
                      aria-label={`Set for ${d.file.name}`}
                      onChange={(e) => patchDraft(i, { collection: e.target.value || null })}
                      className={SELECT_CLASS}
                    >
                      <option value="">Unsorted</option>
                      {pickerSets.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <button
                  onClick={() => removeDraft(d.key)}
                  aria-label={`Remove ${d.file.name}`}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border-strong text-muted-foreground transition-colors hover:border-destructive hover:text-destructive"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={clearDrafts}
              disabled={busy}
              className="min-h-11 flex-1 sm:min-h-0 sm:flex-none"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => void saveDrafts()}
              disabled={busy}
              className="min-h-11 flex-1 sm:min-h-0 sm:flex-none"
            >
              {busy ? "Uploading…" : `Add ${drafts.length} to the set`}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
