import { useState } from "react";
import { secretCardsKey } from "@/lib/query-keys";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, Eye, EyeOff, Loader2, Plus, Trash2 } from "lucide-react";
import {
  createSecretCollection,
  deleteSecretCollection,
  updateSecretCollection,
} from "@/lib/secret-cards.functions";
import { setAccentColor } from "@/lib/secret-cards";
import { setEditRefusal } from "@/lib/secret-set-edit";
import { errorMessage } from "@/lib/errors";
import { SetAccentPicker } from "@/components/set-accent-picker";
import { useSecretSave } from "@/hooks/use-secret-save";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type ManagedSet = {
  id: string;
  label: string;
  accent: string | null;
  active: boolean;
  sortOrder: number;
};

const ROUND_BTN =
  "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border-strong text-muted-foreground";

/**
 * Sets are data, not code: the commissioner invents a collection the week it
 * becomes funny, so making one has to happen here rather than in a release.
 * Folded away by default — most visits are about cards.
 */
export function SecretSetManager({
  sets,
  cardsPerSet,
}: {
  sets: ManagedSet[];
  cardsPerSet: ReadonlyMap<string, number>;
}) {
  const qc = useQueryClient();
  const save = useSecretSave();
  const createSetFn = useServerFn(createSecretCollection);
  const updateSetFn = useServerFn(updateSecretCollection);
  const deleteSetFn = useServerFn(deleteSecretCollection);
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  /** One set edit, with the panel's usual toast + refetch + per-row spinner. */
  function runSetEdit(
    id: string,
    label: string,
    write: Promise<{ ok: boolean; reason?: string }>,
    success: string,
  ) {
    setBusyId(id);
    void save(write, {
      id: `set-${id}`,
      loading: `Saving ${label}…`,
      success: (r) => (r.ok ? success : setEditRefusal(r.reason)),
      failure: "Save failed",
    }).finally(() => setBusyId(null));
  }

  function addSet() {
    const label = newName.trim();
    if (!label) return;
    setNewName("");
    runSetEdit("new", label, createSetFn({ data: { label } }), `${label} added`);
  }

  function moveSet(index: number, delta: number) {
    const a = sets[index];
    const b = sets[index + delta];
    if (!a || !b) return;
    // Swap the two orders outright rather than nudging one, so repeated taps walk
    // a set up the list one place at a time however the numbers were seeded.
    setBusyId(a.id);
    const p = Promise.all([
      updateSetFn({ data: { id: a.id, sortOrder: b.sortOrder } }),
      updateSetFn({ data: { id: b.id, sortOrder: a.sortOrder } }),
    ]).then(async () => {
      await qc.invalidateQueries({ queryKey: secretCardsKey() });
    });
    void p
      .catch((e) => toast.error(errorMessage(e, "Reorder failed")))
      .finally(() => setBusyId(null));
  }

  return (
    <div className="mt-3 rounded-lg border border-white/10">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-11 w-full items-center justify-between gap-2 px-3 text-left"
      >
        <span className="font-display text-xs font-black uppercase tracking-[0.08em] text-primary">
          Sets
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="text-label uppercase tracking-[0.08em] text-muted-foreground">
            {sets.length}
          </span>
          <ChevronDown
            aria-hidden
            className={cn("h-4 w-4 text-primary/70 transition-transform", open && "rotate-180")}
          />
        </span>
      </button>
      {open && (
        <div className="space-y-2 p-2 pt-0">
          <div className="flex gap-2">
            <Input
              value={newName}
              placeholder="New set, e.g. Cornhole Collection"
              maxLength={40}
              aria-label="New set name"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addSet();
                }
              }}
            />
            <Button
              size="sm"
              onClick={addSet}
              disabled={!newName.trim() || busyId !== null}
              className="min-h-11 shrink-0 sm:min-h-0"
            >
              <Plus className="mr-1 h-3 w-3" aria-hidden />
              Add
            </Button>
          </div>
          {sets.length === 0 && (
            <p className="text-[11px] text-muted-foreground">
              No sets yet. Cards stay in one Unsorted pile until you make one.
            </p>
          )}
          {sets.map((s, i) => (
            <div
              key={s.id}
              className={cn("rounded border border-white/10 p-2", !s.active && "opacity-50")}
              style={
                setAccentColor(s.accent)
                  ? {
                      borderColor: `color-mix(in oklab, ${setAccentColor(s.accent)} 35%, transparent)`,
                    }
                  : undefined
              }
            >
              <div className="flex items-center gap-2">
                <Input
                  defaultValue={s.label}
                  maxLength={40}
                  aria-label={`Name for ${s.label}`}
                  // Uncontrolled: the id never changes, so a rename is just a
                  // label edit that can settle on blur like weight does.
                  onBlur={(e) => {
                    const label = e.target.value.trim();
                    if (!label || label === s.label) return;
                    runSetEdit(s.id, label, updateSetFn({ data: { id: s.id, label } }), "Renamed");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                  className="min-w-0 flex-1"
                />
                <span className="shrink-0 text-label uppercase tracking-[0.08em] text-muted-foreground">
                  {cardsPerSet.get(s.id) ?? 0}
                </span>
                {busyId === s.id && (
                  <Loader2
                    className="h-3 w-3 shrink-0 animate-spin text-muted-foreground"
                    aria-hidden
                  />
                )}
                <button
                  type="button"
                  onClick={() => moveSet(i, -1)}
                  disabled={i === 0 || busyId !== null}
                  aria-label={`Move ${s.label} up`}
                  className={cn(ROUND_BTN, "disabled:opacity-30")}
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => moveSet(i, 1)}
                  disabled={i === sets.length - 1 || busyId !== null}
                  aria-label={`Move ${s.label} down`}
                  className={cn(ROUND_BTN, "disabled:opacity-30")}
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    runSetEdit(
                      s.id,
                      s.label,
                      updateSetFn({ data: { id: s.id, active: !s.active } }),
                      s.active ? `${s.label} hidden` : `${s.label} back in the list`,
                    )
                  }
                  disabled={busyId !== null}
                  aria-label={s.active ? `Hide ${s.label}` : `Show ${s.label}`}
                  className={ROUND_BTN}
                >
                  {s.active ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
                {/* The set's colour, picked from the fixed palette rather than a
                    free colour input: every other colour in the app is a designed
                    token, and a set that can be any hue can be an unreadable one. */}
                <SetAccentPicker
                  accent={s.accent}
                  setLabel={s.label}
                  disabled={busyId !== null}
                  onPick={(accentId, accentLabel) =>
                    runSetEdit(
                      s.id,
                      s.label,
                      updateSetFn({ data: { id: s.id, accent: accentId } }),
                      accentId ? `${s.label} is ${accentLabel}` : `${s.label} untinted`,
                    )
                  }
                />
                <button
                  type="button"
                  onClick={() => {
                    // Deleting a set with cards in it would strand them under a
                    // raw slug, so the server refuses; this is only ever the
                    // "made a typo, made it twice" case.
                    if (!confirm(`Delete the "${s.label}" set? Only works if it's empty.`)) return;
                    runSetEdit(s.id, s.label, deleteSetFn({ data: { id: s.id } }), "Set deleted");
                  }}
                  disabled={busyId !== null}
                  aria-label={`Delete ${s.label}`}
                  className={cn(ROUND_BTN, "hover:border-destructive hover:text-destructive")}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
