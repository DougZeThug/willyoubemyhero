import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ChevronDown, EyeOff, Loader2, Trash2, UploadCloud, X } from "lucide-react";
import {
  createSecretCards,
  deleteSecretCard,
  grantSecretCard,
  listSecretCards,
  updateSecretCard,
  updateSecretCollectionLook,
  uploadSecretCardArt,
} from "@/lib/secret-cards.functions";
import { encodeUploadImage } from "@/lib/image-encode";
import { AdminSection } from "@/components/admin-section";
import { BorderFxPicker, FoilPicker, FoilSwatch } from "@/components/secret-look-picker";
import {
  SECRET_BORDER_FX_OPTIONS,
  SECRET_COLLECTIONS,
  SECRET_FOIL_OPTIONS,
  groupBySecretCollection,
  secretCollectionLabel,
} from "@/lib/secret-cards";
import {
  SecretArtThumb,
  SecretCardTile,
  type Roster,
  type SecretCardAdminRow,
} from "@/components/secret-card-tile";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Matches the per-card cap in secret-cards.functions.ts (12M base64 chars ≈ 8.8 MB raw). */
const MAX_BYTES = 8_800_000;
const ACCEPT = ["image/png", "image/jpeg", "image/webp"];
const MAX_FLAVOUR = 240;

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

type Draft = {
  key: string;
  name: string;
  flavour: string;
  collection: string | null;
  file: File;
  previewUrl: string;
};

/**
 * Authoring the secret set.
 *
 * These rows belong to the league, not to a combine, so nothing here takes an
 * event id — see requireLeagueAdmin. The panel is the only place in the app that
 * sees the whole set, and the owner counts are the one thing that escapes the
 * silence rule: without them the commissioner cannot tell when everyone has found
 * everything and the daily drop has quietly become nothing but duplicates.
 */
export function SecretCardsPanel() {
  const qc = useQueryClient();
  const listFn = useServerFn(listSecretCards);
  const createFn = useServerFn(createSecretCards);
  const updateFn = useServerFn(updateSecretCard);
  const setLookFn = useServerFn(updateSecretCollectionLook);
  const uploadFn = useServerFn(uploadSecretCardArt);
  const deleteFn = useServerFn(deleteSecretCard);
  const grantFn = useServerFn(grantSecretCard);

  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  // Per-card grant target: the participant id currently chosen in that row's picker.
  const [grantTarget, setGrantTarget] = useState<Record<string, string>>({});
  // Per-row pending flags so each row shows its own spinner and neighbour rows
  // stay interactive while one card is saving.
  const [grantingId, setGrantingId] = useState<string | null>(null);
  const [savingWeightId, setSavingWeightId] = useState<string | null>(null);
  // A set rather than a single id like the two above: look saves fire on every
  // pick, so two rows can genuinely be in flight at once and one row's finally
  // must not clear the other's spinner.
  const [savingLookIds, setSavingLookIds] = useState<ReadonlySet<string>>(new Set());
  // Sets currently having a whole-collection look applied ("" for unsorted).
  const [savingSetIds, setSavingSetIds] = useState<ReadonlySet<string>>(new Set());
  // Per-card save chain — see saveLook. A ref, not state: nothing renders from
  // it, and a queue that re-rendered the panel on every keystroke would be its
  // own problem.
  const lookQueue = useRef(new Map<string, Promise<void>>());
  // The one row whose border previews may animate — see BorderFxPicker.animate.
  const [lookRow, setLookRow] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editFlavour, setEditFlavour] = useState("");
  // Which set new uploads are filed into. Sticky across drops, because the whole
  // point is dumping twelve WAGs in one go.
  const [uploadCollection, setUploadCollection] = useState<string | null>(null);
  // Collapsed sets, by id ("" for unsorted). Everything starts open — a set the
  // admin just filed a card into going quiet would read as the card vanishing.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  // No eventId in the key, which is itself the documentation that the set is
  // league-wide — and keeps the panel from going stale when the active event
  // rolls over next year.
  const list = useQuery({
    queryKey: ["secret-cards"],
    queryFn: () => listFn(),
    staleTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });

  const cards = (list.data?.cards ?? []) as SecretCardAdminRow[];
  const roster: Roster = list.data?.participants ?? [];

  function addFiles(files: File[]) {
    const next: Draft[] = [];
    for (const file of files) {
      if (!ACCEPT.includes(file.type) && !/\.(png|jpe?g|webp)$/i.test(file.name)) {
        toast.error(`${file.name}: card art must be a PNG, JPEG, or WebP`);
        continue;
      }
      if (file.size > MAX_BYTES) {
        toast.error(`${file.name}: card art is over 8.8 MB`);
        continue;
      }
      next.push({
        key: `${file.name}-${file.size}-${next.length}`,
        name: nameFromFile(file.name),
        flavour: "",
        collection: uploadCollection,
        file,
        // Revoked in clearDrafts / removeDraft, and after a successful save.
        previewUrl: URL.createObjectURL(file),
      });
    }
    setDrafts((prev) => [...prev, ...next]);
  }

  async function saveDrafts() {
    if (drafts.length === 0) return;
    const unnamed = drafts.find((d) => !d.name.trim());
    if (unnamed) {
      toast.error("Give the card a name");
      return;
    }
    setBusy(true);
    try {
      const encoded = await Promise.all(
        drafts.map(async (d) => ({
          name: d.name.trim(),
          // Wording stays optional and editable later. The art gets uploaded at
          // 11pm; the jokes get written on the train. A form that refuses to save
          // without wording guarantees seven unfinished cards.
          flavour: d.flavour.trim() || undefined,
          collection: d.collection ?? undefined,
          dataUrl: await encodeUploadImage(d.file),
        })),
      );
      const res = await createFn({ data: { cards: encoded } });
      const failed = res.results.filter((r) => !r.ok);
      await qc.invalidateQueries({ queryKey: ["secret-cards"] });
      clearDrafts();
      if (failed.length > 0) {
        toast.error(`${failed.length} card${failed.length === 1 ? "" : "s"} failed to upload`);
      } else {
        toast.success(`${res.results.length} added to the set`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  function clearDrafts() {
    setDrafts((prev) => {
      prev.forEach((d) => URL.revokeObjectURL(d.previewUrl));
      return [];
    });
  }

  function removeDraft(key: string) {
    setDrafts((prev) => {
      const gone = prev.find((d) => d.key === key);
      if (gone) URL.revokeObjectURL(gone.previewUrl);
      return prev.filter((d) => d.key !== key);
    });
  }

  async function saveEdit(id: string) {
    setBusy(true);
    const p = updateFn({
      data: { id, name: editName.trim(), flavour: editFlavour.trim() || null },
    }).then(async (r) => {
      await qc.invalidateQueries({ queryKey: ["secret-cards"] });
      return r;
    });
    toast.promise(p, {
      loading: "Saving card…",
      success: "Card updated",
      error: (e) => (e instanceof Error ? e.message : "Save failed"),
    });
    try {
      await p;
      setEditing(null);
    } catch {
      // toast.promise already surfaced the error
    } finally {
      setBusy(false);
    }
  }

  async function replaceArt(id: string, file: File) {
    setBusy(true);
    try {
      await uploadFn({ data: { id, dataUrl: await encodeUploadImage(file) } });
      await qc.invalidateQueries({ queryKey: ["secret-cards"] });
      toast.success("Art replaced");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  // Weight edits save on blur / enter. Debouncing on every keystroke would hide
  // the "did it save?" moment; a full save button per row is more taps than the
  // change deserves. Leave clears back to 100 (baseline uniform).
  async function saveWeight(id: string, raw: string) {
    const parsed = raw.trim() === "" ? 100 : Number(raw);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 10_000) {
      toast.error("Weight must be a whole number between 0 and 10,000");
      return;
    }
    setSavingWeightId(id);
    const p = updateFn({ data: { id, weight: parsed } }).then(async (r) => {
      await qc.invalidateQueries({ queryKey: ["secret-cards"] });
      return r;
    });
    toast.promise(p, {
      loading: "Saving weight…",
      success:
        parsed === 0 ? "Weight saved — card excluded from packs" : `Weight saved (${parsed})`,
      error: (e) => (e instanceof Error ? e.message : "Save failed"),
    });
    try {
      await p;
    } catch {
      // toast.promise already surfaced the error
    } finally {
      setSavingWeightId(null);
    }
  }

  // Unlike weight there is no blur ambiguity: picking an option *is* the intent,
  // so a look saves on change.
  //
  // The strips stay enabled while that save is in flight, which is not an
  // oversight: disabling a focused radio hands focus back to <body>, so a
  // keyboard user would get exactly one arrow press per round-trip and then have
  // to Tab back in. The spinner is the in-flight signal instead, and the queue
  // below is what the `disabled` was really guarding.
  function saveLook(
    id: string,
    look: { foil?: string; borderFx?: string; collection?: string | null },
  ) {
    setSavingLookIds((prev) => new Set(prev).add(id));
    // One chain per card. Arrow keys walk the strip and fire a save per step, so
    // a row can genuinely have two updates outstanding — and unchained, the row
    // settles on whichever the network delivered last rather than on the last
    // key the admin pressed.
    const queued = lookQueue.current.get(id) ?? Promise.resolve();
    const run = queued
      .then(async () => {
        const p = updateFn({ data: { id, ...look } }).then(async (r) => {
          await qc.invalidateQueries({ queryKey: ["secret-cards"] });
          return r;
        });
        toast.promise(p, {
          // A stable id per card, so arrowing across thirteen foils replaces one
          // toast rather than stacking thirteen.
          id: `look-${id}`,
          loading: look.collection !== undefined ? "Filing card…" : "Saving look…",
          success:
            look.collection !== undefined
              ? `Filed under ${secretCollectionLabel(look.collection)}`
              : "Look saved",
          error: (e) => (e instanceof Error ? e.message : "Save failed"),
        });
        try {
          await p;
        } catch {
          // toast.promise already surfaced the error, and swallowing it here is
          // what keeps the chain alive for the keystrokes still queued behind it.
        }
      })
      .finally(() => {
        // Only the last save queued for this row clears its spinner.
        if (lookQueue.current.get(id) !== run) return;
        lookQueue.current.delete(id);
        setSavingLookIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      });
    lookQueue.current.set(id, run);
  }

  /**
   * One foil or border for a whole set. A single server write rather than a
   * loop of per-card saves: filing twelve WAGs under one look is the unit an
   * admin actually thinks in, and twelve round trips is what made them not do it.
   */
  function saveSetLook(
    collection: string | null,
    label: string,
    look: { foil?: string; borderFx?: string },
  ) {
    const key = collection ?? "";
    setSavingSetIds((prev) => new Set(prev).add(key));
    const p = setLookFn({ data: { collection, ...look } }).then(async (r) => {
      await qc.invalidateQueries({ queryKey: ["secret-cards"] });
      return r;
    });
    toast.promise(p, {
      id: `set-look-${key}`,
      loading: `Applying to ${label}…`,
      success: (r) => `${label}: ${r.updated} card${r.updated === 1 ? "" : "s"} updated`,
      error: (e) => (e instanceof Error ? e.message : "Save failed"),
    });
    void p
      .catch(() => {
        // toast.promise already surfaced it.
      })
      .finally(() => {
        setSavingSetIds((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      });
  }

  async function grant(card: SecretCardAdminRow) {
    const participantId = grantTarget[card.id];
    if (!participantId) {
      toast.error("Pick a participant first");
      return;
    }
    const who = roster.find((p) => p.id === participantId)?.name ?? "participant";
    setGrantingId(card.id);
    const p = grantFn({ data: { participantId, cardId: card.id } }).then(async (r) => {
      await qc.invalidateQueries({ queryKey: ["secret-cards"] });
      return r;
    });
    toast.promise(p, {
      loading: `Granting "${card.name}" to ${who}…`,
      success: (r) =>
        r.duplicate
          ? `${who} already had "${card.name}" — logged as a duplicate`
          : `Granted "${card.name}" to ${who}`,
      error: (e) => (e instanceof Error ? e.message : "Grant failed"),
    });
    try {
      await p;
      setGrantTarget((prev) => ({ ...prev, [card.id]: "" }));
    } catch {
      // toast.promise already surfaced the error
    } finally {
      setGrantingId(null);
    }
  }

  async function remove(card: SecretCardAdminRow) {
    if (
      !confirm(
        `Remove "${card.name}" from the set? Anyone who already pulled it keeps it in their vault.`,
      )
    )
      return;
    setBusy(true);
    try {
      const res = await deleteFn({ data: { id: card.id } });
      await qc.invalidateQueries({ queryKey: ["secret-cards"] });
      // The sheet is the only place Remove lives now, so it has to close itself.
      setEditing(null);
      toast.success(
        res.ok ? "Removed from the set" : "Retired — it stays in the vaults of whoever pulled it",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Remove failed");
    } finally {
      setBusy(false);
    }
  }

  const editingCard = cards.find((c) => c.id === editing) ?? null;

  return (
    // EyeOff rather than Sparkles: Sparkles already belongs to the pack.
    <AdminSection
      icon={<EyeOff className="h-4 w-4 shrink-0" />}
      title="Secret Cards"
      meta={`${cards.length} in the set`}
    >
      <p className="text-[11px] leading-snug text-muted-foreground">
        Secret cards belong to the league, not to one combine. Upload once and they keep turning up
        in packs every year.
      </p>
      {list.data?.exhausted && (
        <p className="mt-1 text-[11px] leading-snug text-warn">
          Everyone who plays has pulled all {cards.filter((c) => c.active && c.hasArt).length}. New
          cards show up in tomorrow&apos;s packs.
        </p>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addFiles(Array.from(e.dataTransfer.files ?? []));
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
          "mt-3 cursor-pointer rounded-lg border border-dashed p-5 text-center transition-colors",
          dragging
            ? "border-primary bg-primary/10"
            : "border-white/15 hover:border-primary/50 hover:bg-white/[0.02]",
          busy && "pointer-events-none opacity-60",
        )}
      >
        <UploadCloud className="mx-auto h-8 w-8 text-primary/70" aria-hidden />
        <p className="mt-2 font-display text-sm font-bold uppercase tracking-widest text-foreground">
          {busy ? "Uploading…" : <span className="max-sm:hidden">Drop card art here</span>}
          {!busy && <span className="sm:hidden">Add card art</span>}
        </p>
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
          The filename becomes the card&apos;s name. PNG, JPEG or WebP, up to 8.8 MB. Portrait,
          roughly 5:7.
        </p>
        {/* The whole box is a drop target, but on a phone there is nothing to
            drop from — an explicit button is the affordance that reads as tappable. */}
        <Button
          size="sm"
          variant="secondary"
          type="button"
          className="mt-3 min-h-11 sm:min-h-0"
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            inputRef.current?.click();
          }}
        >
          Browse files
        </Button>
        {drafts.length > 0 && (
          <p className="mt-2 text-[10px] font-bold uppercase tracking-widest text-primary">
            {drafts.length} staged
          </p>
        )}
        {/* Filed on the way in, so a batch of twelve is one pick rather than
            twelve. Stops the click from reaching the drop target behind it. */}
        <label
          className="mx-auto mt-3 flex max-w-xs items-center gap-2"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="shrink-0 text-[10px] uppercase tracking-widest text-muted-foreground">
            Add to
          </span>
          <select
            value={uploadCollection ?? ""}
            onChange={(e) => setUploadCollection(e.target.value || null)}
            className="min-h-11 w-full min-w-0 rounded border border-white/15 bg-background px-1.5 text-base text-foreground sm:min-h-0 sm:text-xs"
            aria-label="Set for new uploads"
          >
            <option value="">Unsorted</option>
            {SECRET_COLLECTIONS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </div>

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
                    onChange={(e) =>
                      setDrafts((prev) =>
                        prev.map((x, j) => (i === j ? { ...x, name: e.target.value } : x)),
                      )
                    }
                  />
                  <Input
                    value={d.flavour}
                    placeholder="Lit at 11am. Still going at 11pm."
                    maxLength={MAX_FLAVOUR}
                    aria-label={`Wording for ${d.file.name}`}
                    onChange={(e) =>
                      setDrafts((prev) =>
                        prev.map((x, j) => (i === j ? { ...x, flavour: e.target.value } : x)),
                      )
                    }
                  />
                  <p className="text-[10px] leading-snug text-muted-foreground">
                    One line, printed on the back. This is the whole joke — keep it short.
                  </p>
                  <label className="flex items-center gap-2">
                    <span className="shrink-0 text-[10px] uppercase tracking-widest text-muted-foreground">
                      Set
                    </span>
                    <select
                      value={d.collection ?? ""}
                      aria-label={`Set for ${d.file.name}`}
                      onChange={(e) =>
                        setDrafts((prev) =>
                          prev.map((x, j) =>
                            i === j ? { ...x, collection: e.target.value || null } : x,
                          ),
                        )
                      }
                      className="min-h-11 w-full min-w-0 rounded border border-white/15 bg-background px-1.5 text-base text-foreground sm:min-h-0 sm:text-xs"
                    >
                      <option value="">Unsorted</option>
                      {SECRET_COLLECTIONS.map((c) => (
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
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/15 text-muted-foreground transition-colors hover:border-destructive/50 hover:text-destructive"
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

      <div className="mt-3 space-y-3">
        {cards.length === 0 && drafts.length === 0 && (
          <p className="text-[11px] text-muted-foreground">
            No secret cards yet. Packs will just be three cards until there&apos;s at least one.
          </p>
        )}
        {/* One collapsible section per set. The whole point is that the list stays
            navigable at forty cards, which it does not as one flat scroll. */}
        {groupBySecretCollection(cards).map((group) => {
          const key = group.id ?? "";
          const open = !collapsed.has(key);
          return (
            <section key={key} className="rounded-lg border border-white/10">
              <button
                type="button"
                onClick={() =>
                  setCollapsed((prev) => {
                    const next = new Set(prev);
                    if (next.has(key)) next.delete(key);
                    else next.add(key);
                    return next;
                  })
                }
                aria-expanded={open}
                className="flex min-h-11 w-full items-center justify-between gap-2 px-3 text-left"
              >
                <span className="truncate font-display text-xs font-black uppercase tracking-[0.25em] text-primary">
                  {group.label}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    {group.items.length}
                  </span>
                  <ChevronDown
                    aria-hidden
                    className={cn(
                      "h-4 w-4 text-primary/70 transition-transform",
                      open && "rotate-180",
                    )}
                  />
                </span>
              </button>
              {open && (
                <div className="space-y-2 p-2 pt-0">
                  <SetLookRow
                    label={group.label}
                    foil={sharedValue(group.items.map((c) => c.foil))}
                    borderFx={sharedValue(group.items.map((c) => c.borderFx))}
                    saving={savingSetIds.has(key)}
                    onChange={(look) => saveSetLook(group.id, group.label, look)}
                  />
                  {group.items.map((card) => (
                    <SecretCardTile
                      key={card.id}
                      card={card}
                      claimedMembers={list.data?.claimedMembers ?? 0}
                      roster={roster}
                      busy={busy}
                      grantTarget={grantTarget[card.id] ?? ""}
                      onGrantTargetChange={(participantId) =>
                        setGrantTarget((prev) => ({ ...prev, [card.id]: participantId }))
                      }
                      granting={grantingId === card.id}
                      savingWeight={savingWeightId === card.id}
                      savingLook={savingLookIds.has(card.id)}
                      lookRow={lookRow === card.id}
                      onLookRowChange={(active) =>
                        setLookRow((prev) => (active ? card.id : prev === card.id ? null : prev))
                      }
                      onSaveWeight={(raw) => void saveWeight(card.id, raw)}
                      onSaveLook={(look) => saveLook(card.id, look)}
                      onSaveCollection={(collection) => saveLook(card.id, { collection })}
                      onGrant={() => void grant(card)}
                      onEdit={() => {
                        setEditing(card.id);
                        setEditName(card.name);
                        setEditFlavour(card.flavour ?? "");
                      }}
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {/* Naming, wording, art and removal all live here rather than as three
          icon taps in a scrolling row — this is the editing that needs a keyboard
          and room, and on a phone the row never had either. */}
      <Sheet open={!!editingCard} onOpenChange={(open) => !open && setEditing(null)}>
        <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto">
          {editingCard && (
            <>
              <SheetHeader className="text-left">
                <SheetTitle className="font-display uppercase tracking-wide">
                  {editingCard.name}
                </SheetTitle>
                <SheetDescription>
                  Pulled by {editingCard.ownerCount} of {list.data?.claimedMembers ?? 0}
                </SheetDescription>
              </SheetHeader>

              <div className="space-y-4 px-4 pb-6">
                <div className="flex items-start gap-3">
                  <SecretArtThumb card={editingCard} className="w-24" />
                  <label className="min-w-0 flex-1">
                    <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                      Card art
                    </span>
                    <span className="mt-1 flex min-h-11 cursor-pointer items-center justify-center rounded border border-white/15 px-3 text-xs font-bold uppercase tracking-widest text-primary transition-colors hover:border-primary/50">
                      Replace art
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void replaceArt(editingCard.id, file);
                          e.target.value = "";
                        }}
                      />
                    </span>
                  </label>
                </div>

                <label className="block">
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    Name
                  </span>
                  <Input
                    className="mt-1"
                    value={editName}
                    maxLength={60}
                    onChange={(e) => setEditName(e.target.value)}
                  />
                </label>

                <label className="block">
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    Wording
                  </span>
                  <Input
                    className="mt-1"
                    value={editFlavour}
                    maxLength={MAX_FLAVOUR}
                    placeholder="Lit at 11am. Still going at 11pm."
                    onChange={(e) => setEditFlavour(e.target.value)}
                  />
                </label>

                <label className="block">
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    Set
                  </span>
                  {/* Saves on change like the look does, not on Save: it goes
                      through the same per-card queue and needs no keyboard. */}
                  <select
                    value={editingCard.collection ?? ""}
                    onChange={(e) =>
                      saveLook(editingCard.id, { collection: e.target.value || null })
                    }
                    className="mt-1 min-h-11 w-full rounded border border-white/15 bg-background px-2 text-base text-foreground"
                  >
                    <option value="">Unsorted</option>
                    {SECRET_COLLECTIONS.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="space-y-3 rounded-lg border border-white/10 p-3">
                  <FoilPicker
                    value={editingCard.foil}
                    cardName={editingCard.name}
                    onChange={(foil) => saveLook(editingCard.id, { foil })}
                  />
                  <BorderFxPicker
                    value={editingCard.borderFx}
                    foil={editingCard.foil}
                    cardName={editingCard.name}
                    animate
                    onChange={(borderFx) => saveLook(editingCard.id, { borderFx })}
                  />
                </div>

                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    className="min-h-11 flex-1"
                    onClick={() => setEditing(null)}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    className="min-h-11 flex-1"
                    onClick={() => void saveEdit(editingCard.id)}
                    disabled={busy}
                  >
                    Save
                  </Button>
                </div>

                <Button
                  size="sm"
                  variant="ghost"
                  className="min-h-11 w-full text-destructive hover:text-destructive"
                  disabled={busy}
                  onClick={() => void remove(editingCard)}
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  Remove from the set
                </Button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </AdminSection>
  );
}

/** The one value every card in a set shares, or null when they differ. */
function sharedValue(values: readonly string[]): string | null {
  if (values.length === 0) return null;
  const first = values[0];
  return values.every((v) => v === first) ? (first ?? null) : null;
}

/**
 * Foil and border for a whole set.
 *
 * Native selects rather than the swatch strips: this row sits above the tiles
 * and must not read as a card's own control. A set whose cards disagree shows
 * "Mixed" — a real state, so it is selectable-from but never selectable-to.
 */
function SetLookRow({
  label,
  foil,
  borderFx,
  saving,
  onChange,
}: {
  label: string;
  foil: string | null;
  borderFx: string | null;
  saving: boolean;
  onChange: (look: { foil?: string; borderFx?: string }) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-2 rounded border border-white/10 bg-white/[0.03] p-2">
      <span className="w-full text-[10px] uppercase tracking-widest text-muted-foreground">
        Whole set
      </span>
      <label className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="sr-only">Foil for {label}</span>
        {foil && <FoilSwatch foil={foil} />}
        <select
          value={foil ?? ""}
          onChange={(e) => e.target.value && onChange({ foil: e.target.value })}
          disabled={saving}
          aria-label={`Foil for every card in ${label}`}
          className="min-h-11 w-full min-w-0 rounded border border-white/15 bg-background px-1.5 text-base text-foreground sm:min-h-0 sm:h-8 sm:text-xs"
        >
          {!foil && <option value="">Foil · Mixed</option>}
          {SECRET_FOIL_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              Foil · {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="sr-only">Border for {label}</span>
        <select
          value={borderFx ?? ""}
          onChange={(e) => e.target.value && onChange({ borderFx: e.target.value })}
          disabled={saving}
          aria-label={`Border animation for every card in ${label}`}
          className="min-h-11 w-full min-w-0 rounded border border-white/15 bg-background px-1.5 text-base text-foreground sm:min-h-0 sm:h-8 sm:text-xs"
        >
          {!borderFx && <option value="">Border · Mixed</option>}
          {SECRET_BORDER_FX_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              Border · {o.label}
            </option>
          ))}
        </select>
      </label>
      {saving && (
        <Loader2 className="mb-3 h-3 w-3 animate-spin text-muted-foreground" aria-hidden />
      )}
    </div>
  );
}
