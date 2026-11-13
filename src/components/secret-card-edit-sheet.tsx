import { useState } from "react";
import { secretCardsKey } from "@/lib/query-keys";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Trash2, Undo2 } from "lucide-react";
import {
  deleteSecretCard,
  updateSecretCard,
  uploadSecretCardArt,
} from "@/lib/secret-cards.functions";
import { encodeUploadImage, snapshotFile } from "@/lib/image-encode";
import { secretCollectionLabel, type SecretCollection } from "@/lib/secret-cards";
import { BorderFxPicker, FoilPicker } from "@/components/secret-look-picker";
import { SecretArtThumb, type SecretCardAdminRow } from "@/components/secret-card-tile";
import { MAX_FLAVOUR } from "@/components/secret-upload-drafts";
import { useSecretSave } from "@/hooks/use-secret-save";
import type { useAdminAction } from "@/hooks/use-admin-action";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Look = { foil?: string; borderFx?: string; collection?: string | null };

type EditProps = {
  card: SecretCardAdminRow;
  claimedMembers: number;
  /** Every set, hidden ones included: they still name the cards filed under them. */
  sets: SecretCollection[];
  /** The sets that are an option right now. */
  pickerSets: SecretCollection[];
  busy: boolean;
  run: ReturnType<typeof useAdminAction>["run"];
  onSaveLook: (id: string, look: Look) => void;
  onClose: () => void;
};

/**
 * Naming, wording, art and removal all live here rather than as three icon taps
 * in a scrolling row — this is the editing that needs a keyboard and room, and
 * on a phone the row never had either.
 */
export function SecretCardEditSheet({
  card,
  ...rest
}: { card: SecretCardAdminRow | null } & Omit<EditProps, "card">) {
  return (
    <Sheet open={!!card} onOpenChange={(open) => !open && rest.onClose()}>
      <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto">
        {card && <EditBody key={card.id} card={card} {...rest} />}
      </SheetContent>
    </Sheet>
  );
}

function EditBody({
  card,
  claimedMembers,
  sets,
  pickerSets,
  busy,
  run,
  onSaveLook,
  onClose,
}: EditProps) {
  const qc = useQueryClient();
  const save = useSecretSave();
  const updateFn = useServerFn(updateSecretCard);
  const uploadFn = useServerFn(uploadSecretCardArt);
  const deleteFn = useServerFn(deleteSecretCard);
  const [name, setName] = useState(card.name);
  const [flavour, setFlavour] = useState(card.flavour ?? "");
  const activeIds = new Set(pickerSets.map((c) => c.id));

  const refetch = () => qc.invalidateQueries({ queryKey: secretCardsKey() });

  function saveEdit() {
    void run("Save failed", async () => {
      const ok = await save(
        updateFn({ data: { id: card.id, name: name.trim(), flavour: flavour.trim() || null } }),
        { loading: "Saving card…", success: "Card updated", failure: "Save failed" },
      );
      if (ok) onClose();
    });
  }

  function replaceArt(file: File) {
    void run("Upload failed", async () => {
      const staged = await snapshotFile(file);
      await uploadFn({ data: { id: card.id, dataUrl: await encodeUploadImage(staged) } });
      await refetch();
      return "Art replaced";
    });
  }

  /** The way back from a retirement. See the Remove button below. */
  function restore() {
    void run("Could not restore that card", async () => {
      await updateFn({ data: { id: card.id, active: true } });
      await refetch();
      return `"${card.name}" is back in the set`;
    });
  }

  function remove() {
    if (
      !confirm(
        `Remove "${card.name}" from the set? Anyone who already pulled it keeps it in their vault.`,
      )
    )
      return;
    void run("Remove failed", async () => {
      const res = await deleteFn({ data: { id: card.id } });
      await refetch();
      // The sheet is the only place Remove lives now, so it has to close itself.
      onClose();
      return res.ok
        ? "Removed from the set"
        : "Retired — it stays in the vaults of whoever pulled it";
    });
  }

  return (
    <>
      <SheetHeader className="text-left">
        <SheetTitle className="font-display uppercase tracking-wide">{card.name}</SheetTitle>
        <SheetDescription>
          Pulled by {card.ownerCount} of {claimedMembers}
        </SheetDescription>
      </SheetHeader>

      <div className="space-y-4 px-4 pb-6">
        <div className="flex items-start gap-3">
          <SecretArtThumb card={card} className="w-24" />
          <label className="min-w-0 flex-1">
            <span className="text-label uppercase tracking-[0.08em] text-muted-foreground">
              Card art
            </span>
            <span className="mt-1 flex min-h-11 cursor-pointer items-center justify-center rounded border border-border-strong px-3 text-xs font-bold uppercase tracking-[0.08em] text-primary transition-colors hover:border-primary/50">
              Replace art
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) replaceArt(file);
                  e.target.value = "";
                }}
              />
            </span>
          </label>
        </div>

        <label className="block">
          <span className="text-label uppercase tracking-[0.08em] text-muted-foreground">Name</span>
          <Input
            className="mt-1"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <label className="block">
          <span className="text-label uppercase tracking-[0.08em] text-muted-foreground">
            Wording
          </span>
          <Input
            className="mt-1"
            value={flavour}
            maxLength={MAX_FLAVOUR}
            placeholder="Lit at 11am. Still going at 11pm."
            onChange={(e) => setFlavour(e.target.value)}
          />
        </label>

        <label className="block">
          <span className="text-label uppercase tracking-[0.08em] text-muted-foreground">Set</span>
          {/* Saves on change like the look does, not on Save: it goes
              through the same per-card queue and needs no keyboard. */}
          <select
            value={card.collection ?? ""}
            onChange={(e) => onSaveLook(card.id, { collection: e.target.value || null })}
            className="mt-1 min-h-11 w-full rounded border border-border-strong bg-background px-2 text-base text-foreground"
          >
            <option value="">Unsorted</option>
            {/* A card can sit in a set that has since been hidden. Without
                its own option the select falls back to showing
                "Unsorted" over a card that is not, and re-picking it
                does not fire onChange. Named by the full list: the
                picker's one would show the raw id. */}
            {card.collection && !activeIds.has(card.collection) && (
              <option value={card.collection}>
                {secretCollectionLabel(card.collection, sets)} (hidden)
              </option>
            )}
            {pickerSets.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>

        <div className="space-y-3 rounded-lg border border-white/10 p-3">
          <FoilPicker
            value={card.foil}
            cardName={card.name}
            onChange={(foil) => onSaveLook(card.id, { foil })}
          />
          <BorderFxPicker
            value={card.borderFx}
            foil={card.foil}
            cardName={card.name}
            animate
            onChange={(borderFx) => onSaveLook(card.id, { borderFx })}
          />
        </div>

        <div className="flex gap-2">
          <Button size="sm" variant="secondary" className="min-h-11 flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" className="min-h-11 flex-1" onClick={saveEdit} disabled={busy}>
            Save
          </Button>
        </div>

        {/* A card somebody has already pulled is retired rather than
            deleted, and updateSecretCard has always accepted the field
            that would bring it back — the panel simply never sent it,
            so there was no way out of a retirement from any screen. */}
        {card.active ? (
          <Button
            size="sm"
            variant="ghost"
            className="min-h-11 w-full text-destructive hover:text-destructive"
            disabled={busy}
            onClick={remove}
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            Remove from the set
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="min-h-11 w-full text-primary hover:text-primary"
            disabled={busy}
            onClick={restore}
          >
            <Undo2 className="mr-1.5 h-3.5 w-3.5" />
            Put it back in the set
          </Button>
        )}
      </div>
    </>
  );
}
