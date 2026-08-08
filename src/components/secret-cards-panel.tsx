import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { EyeOff, Trash2, UploadCloud, X } from "lucide-react";
import {
  createSecretCards,
  deleteSecretCard,
  grantSecretCard,
  listSecretCards,
  updateSecretCard,
  uploadSecretCardArt,
} from "@/lib/secret-cards.functions";
import { encodeUploadImage } from "@/lib/image-encode";
import { AdminSection } from "@/components/admin-section";
import { BorderFxPicker, FoilPicker } from "@/components/secret-look-picker";
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

type Draft = { key: string; name: string; flavour: string; file: File; previewUrl: string };

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
  // Per-card save chain — see saveLook. A ref, not state: nothing renders from
  // it, and a queue that re-rendered the panel on every keystroke would be its
  // own problem.
  const lookQueue = useRef(new Map<string, Promise<void>>());
  // The one row whose border previews may animate — see BorderFxPicker.animate.
  const [lookRow, setLookRow] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editFlavour, setEditFlavour] = useState("");

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
        file,
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
          dataUrl: await encodeUploadImage(d.file),
        })),
      );
      const res = await createFn({ data: { cards: encoded } });
      const failed = res.results.filter((r) => !r.ok);
      await qc.invalidateQueries({ queryKey: ["secret-cards"] });
      setDrafts([]);
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
  function saveLook(id: string, look: { foil?: string; borderFx?: string }) {
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
          loading: "Saving look…",
          success: "Look saved",
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
      toast.success(
        res.ok ? "Removed from the set" : "Retired — it stays in the vaults of whoever pulled it",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Remove failed");
    } finally {
      setBusy(false);
    }
  }

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
        <p className="font-display text-sm font-bold uppercase tracking-widest text-foreground">
          {busy ? "Uploading…" : "Drop card art here"}
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          The filename becomes the card&apos;s name. PNG, JPEG or WebP, up to 8.8 MB. Portrait,
          roughly 5:7.
        </p>
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
            <div key={d.key} className="rounded-lg border border-white/10 p-2">
              <Input
                value={d.name}
                placeholder="Gary the Grill"
                maxLength={60}
                onChange={(e) =>
                  setDrafts((prev) =>
                    prev.map((x, j) => (i === j ? { ...x, name: e.target.value } : x)),
                  )
                }
              />
              <Input
                className="mt-1.5"
                value={d.flavour}
                placeholder="Lit at 11am. Still going at 11pm."
                maxLength={MAX_FLAVOUR}
                onChange={(e) =>
                  setDrafts((prev) =>
                    prev.map((x, j) => (i === j ? { ...x, flavour: e.target.value } : x)),
                  )
                }
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                One line, printed on the back. This is the whole joke — keep it short.
              </p>
            </div>
          ))}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => setDrafts([])} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" onClick={saveDrafts} disabled={busy}>
              Add to the set
            </Button>
          </div>
        </div>
      )}

      <div className="mt-3 space-y-2">
        {cards.length === 0 && drafts.length === 0 && (
          <p className="text-[11px] text-muted-foreground">
            No secret cards yet. Packs will just be three cards until there&apos;s at least one.
          </p>
        )}
        {cards.map((card) => (
          <div
            key={card.id}
            className={cn(
              "flex items-center gap-3 rounded-lg border border-white/10 p-2",
              !card.active && "opacity-50",
            )}
          >
            {card.artUrl ? (
              <img
                src={card.artUrl}
                alt=""
                className="h-11 w-11 shrink-0 rounded object-cover"
                loading="lazy"
              />
            ) : (
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded bg-white/5 text-[8px] uppercase text-muted-foreground">
                No art
              </div>
            )}

            {editing === card.id ? (
              <div className="min-w-0 flex-1">
                <Input
                  value={editName}
                  maxLength={60}
                  onChange={(e) => setEditName(e.target.value)}
                />
                <Input
                  className="mt-1.5"
                  value={editFlavour}
                  maxLength={MAX_FLAVOUR}
                  placeholder="Lit at 11am. Still going at 11pm."
                  onChange={(e) => setEditFlavour(e.target.value)}
                />
                <div className="mt-1.5 flex justify-end gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={() => void saveEdit(card.id)} disabled={busy}>
                    Save
                  </Button>
                </div>
              </div>
            ) : (
              <div className="min-w-0 flex-1">
                <div className="truncate font-display text-xs font-bold uppercase tracking-wide">
                  {card.name}
                  {!card.active && " · Retired"}
                  {!card.hasArt && " · No art, not in packs"}
                </div>
                <div className="truncate text-[10px] text-muted-foreground">
                  {card.flavour || "No wording yet"}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  Pulled by {card.ownerCount} of {list.data?.claimedMembers ?? 0}
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
                    Weight
                    <input
                      type="number"
                      min={0}
                      max={10000}
                      step={10}
                      defaultValue={card.weight}
                      // Uncontrolled so typing doesn't refire the query on every
                      // keystroke. `key` on the card wrapper isn't set, so the
                      // default only re-seeds after a server round-trip.
                      onBlur={(e) => {
                        if (Number(e.target.value) !== card.weight) {
                          void saveWeight(card.id, e.target.value);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      }}
                      disabled={savingWeightId === card.id}
                      className="h-6 w-16 rounded border border-white/15 bg-background px-1.5 text-xs tabular-nums"
                      aria-label={`Pull weight for ${card.name}`}
                    />
                  </label>
                  <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    {savingWeightId === card.id && (
                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                    )}
                    {card.weight === 0
                      ? "Excluded from packs"
                      : "Higher = shows up more often (100 = baseline)"}
                  </span>
                </div>

                <div
                  className="mt-2 flex flex-col gap-2"
                  // Which row's border previews are allowed to animate. Pointer
                  // enter covers a mouse, focus covers a keyboard, and a tap
                  // fires both — see the note on BorderFxPicker's `animate`.
                  onPointerEnter={() => setLookRow(card.id)}
                  onPointerLeave={() => setLookRow((prev) => (prev === card.id ? null : prev))}
                  onFocusCapture={() => setLookRow(card.id)}
                  onBlurCapture={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget)) {
                      setLookRow((prev) => (prev === card.id ? null : prev));
                    }
                  }}
                >
                  <FoilPicker
                    value={card.foil}
                    cardName={card.name}
                    onChange={(foil) => saveLook(card.id, { foil })}
                  />
                  <div className="flex items-end gap-2">
                    <BorderFxPicker
                      value={card.borderFx}
                      foil={card.foil}
                      cardName={card.name}
                      animate={lookRow === card.id}
                      onChange={(borderFx) => saveLook(card.id, { borderFx })}
                    />
                    {savingLookIds.has(card.id) && (
                      <Loader2
                        className="mb-1.5 h-3 w-3 animate-spin text-muted-foreground"
                        aria-hidden
                      />
                    )}
                  </div>
                </div>

                {roster.length > 0 && card.hasArt && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <select
                      value={grantTarget[card.id] ?? ""}
                      onChange={(e) =>
                        setGrantTarget((prev) => ({ ...prev, [card.id]: e.target.value }))
                      }
                      disabled={busy}
                      className="h-7 min-w-0 flex-1 rounded border border-white/15 bg-background px-1.5 text-xs"
                      aria-label={`Grant ${card.name} to`}
                    >
                      <option value="">Grant to…</option>
                      {roster.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void grant(card)}
                      disabled={grantingId === card.id || !grantTarget[card.id]}
                      className="h-7 px-2 text-[10px]"
                    >
                      {grantingId === card.id ? (
                        <>
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden />
                          Granting…
                        </>
                      ) : (
                        <>
                          <Gift className="mr-1 h-3 w-3" />
                          Grant
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </div>
            )}

            {editing !== card.id && (
              <div className="flex shrink-0 items-center gap-1">
                <label className="cursor-pointer rounded p-2 text-muted-foreground hover:text-primary">
                  <Pencil className="h-3.5 w-3.5" />
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void replaceArt(card.id, file);
                      e.target.value = "";
                    }}
                  />
                </label>
                <button
                  onClick={() => {
                    setEditing(card.id);
                    setEditName(card.name);
                    setEditFlavour(card.flavour ?? "");
                  }}
                  className="rounded p-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:text-primary"
                >
                  Edit
                </button>
                <button
                  onClick={() => void remove(card)}
                  disabled={busy}
                  className="rounded p-2 text-muted-foreground hover:text-destructive"
                  aria-label={`Remove ${card.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </AdminSection>
  );
}
