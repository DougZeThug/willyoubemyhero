import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, ArrowUpDown, Flag, Pencil, Plus, Trash2 } from "lucide-react";
import { upsertStation, deleteStation } from "@/lib/admin-write.functions";
import { useEventBundle } from "@/hooks/use-event-bundle";
import { AdminSection } from "@/components/admin-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

type StationRow = {
  id: string;
  name: string;
  short_name: string | null;
  description: string | null;
  station_order: number;
  icon: string | null;
  split_enabled: boolean;
  penalty_amount_ms: number;
  active: boolean;
};

type Draft = {
  id?: string;
  name: string;
  short_name: string;
  description: string;
  station_order: number;
  split_enabled: boolean;
  penalty_seconds: number;
  active: boolean;
};

function toDraft(s: StationRow): Draft {
  return {
    id: s.id,
    name: s.name,
    short_name: s.short_name ?? "",
    description: s.description ?? "",
    station_order: s.station_order,
    split_enabled: s.split_enabled,
    penalty_seconds: Math.round(s.penalty_amount_ms / 1000),
    active: s.active,
  };
}

/**
 * Rename, reorder, add and retire the course stations.
 *
 * Stations are the spine of a run: their order is the order of the split
 * buttons, and their names end up on the card back and the "vs. the field"
 * ladder. Renaming is always safe. Reordering after runs exist reshuffles that
 * ladder, so the panel warns. Deleting a station that already carries splits or
 * penalties would orphan finished runs, so that is blocked outright — retire it
 * with the Active switch instead, which keeps the history and drops it from the
 * timing console.
 */
export function StationsPanel({ eventId }: { eventId: string }) {
  const { bundle } = useEventBundle();
  const qc = useQueryClient();
  const saveFn = useServerFn(upsertStation);
  const removeFn = useServerFn(deleteStation);

  const [rearranging, setRearranging] = useState(false);
  // Bulk rename keeps its own draft map so a half-typed batch is never written
  // until the admin taps save — the per-station sheet stays for everything else.
  const [renames, setRenames] = useState<Record<
    string,
    { name: string; short_name: string }
  > | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const stations = useMemo(
    () =>
      ((bundle?.stations ?? []) as StationRow[])
        .slice()
        .sort((a, b) => a.station_order - b.station_order),
    [bundle?.stations],
  );

  // Splits and penalties both point at a station; either one makes a station
  // load-bearing for a finished run.
  const used = useMemo(() => {
    const ids = new Set<string>();
    for (const s of bundle?.splits ?? []) {
      const id = (s as { station_id?: string | null }).station_id;
      if (id) ids.add(id);
    }
    for (const p of bundle?.penalties ?? []) {
      const id = (p as { station_id?: string | null }).station_id;
      if (id) ids.add(id);
    }
    return ids;
  }, [bundle?.splits, bundle?.penalties]);

  const hasRuns = (bundle?.runs ?? []).length > 0;

  const refresh = () => qc.invalidateQueries({ queryKey: ["event-bundle", eventId] });

  async function save(d: Draft) {
    await saveFn({
      data: {
        eventId,
        ...(d.id ? { id: d.id } : {}),
        name: d.name.trim(),
        short_name: d.short_name.trim() || null,
        description: d.description.trim() || null,
        station_order: d.station_order,
        split_enabled: d.split_enabled,
        penalty_amount_ms: Math.max(0, Math.round(d.penalty_seconds * 1000)),
        active: d.active,
      },
    });
  }

  async function onSaveDraft() {
    if (!draft) return;
    if (!draft.name.trim()) {
      toast.error("A station needs a name");
      return;
    }
    setBusy(true);
    try {
      await save(draft);
      await refresh();
      toast.success(draft.id ? "Station saved" : "Station added");
      setDraft(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save that station");
    } finally {
      setBusy(false);
    }
  }

  async function move(index: number, dir: -1 | 1) {
    const a = stations[index];
    const b = stations[index + dir];
    if (!a || !b) return;
    setBusy(true);
    try {
      // One RPC swaps both sort values in a single transaction — two separate
      // writes could half-apply and leave the pair sharing a station_order.
      await swapFn({ data: { eventId, aId: a.id, bId: b.id } });
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not reorder stations");
    } finally {
      setBusy(false);
    }
  }

  function startRenaming() {
    const draftMap: Record<string, { name: string; short_name: string }> = {};
    for (const s of stations) draftMap[s.id] = { name: s.name, short_name: s.short_name ?? "" };
    setRenames(draftMap);
    setRearranging(false);
  }

  async function onSaveNames() {
    if (!renames) return;
    const changed = stations.filter((s) => {
      const d = renames[s.id];
      return d && (d.name.trim() !== s.name || d.short_name.trim() !== (s.short_name ?? ""));
    });
    const blank = changed.find((s) => !renames[s.id]?.name.trim());
    if (blank) {
      toast.error("Every station needs a name");
      return;
    }
    if (changed.length === 0) {
      setRenames(null);
      return;
    }
    setBusy(true);
    try {
      // One write per changed row: a failure halfway leaves the earlier renames
      // saved, so the message names the station that stopped the batch.
      for (const s of changed) {
        const d = renames[s.id]!;
        try {
          await save({ ...toDraft(s), name: d.name.trim(), short_name: d.short_name.trim() });
        } catch (e) {
          throw new Error(`${s.name} did not save${e instanceof Error ? `: ${e.message}` : ""}`);
        }
      }
      await refresh();
      toast.success(`Renamed ${changed.length} station${changed.length === 1 ? "" : "s"}`);
      setRenames(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save those names");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(s: StationRow) {
    if (used.has(s.id)) {
      toast.error(`${s.name} has recorded times — switch it to inactive instead`);
      return;
    }
    if (!confirm(`Delete ${s.name}?`)) return;
    setBusy(true);
    try {
      await removeFn({ data: { eventId, id: s.id } });
      await refresh();
      toast.success("Station deleted");
      setDraft(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete that station");
    } finally {
      setBusy(false);
    }
  }

  function onAdd() {
    const nextOrder = stations.length ? Math.max(...stations.map((s) => s.station_order)) + 1 : 1;
    setDraft({
      name: "",
      short_name: "",
      description: "",
      station_order: nextOrder,
      split_enabled: true,
      penalty_seconds: 0,
      active: true,
    });
  }

  return (
    <AdminSection
      icon={<Flag className="h-4 w-4 shrink-0" />}
      title="Stations"
      meta={`${stations.length} station${stations.length === 1 ? "" : "s"}`}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Tap a station to rename it or change its penalty.
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="sm"
            variant={renames ? "default" : "ghost"}
            onClick={() => (renames ? setRenames(null) : startRenaming())}
            className="min-h-9 shrink-0"
          >
            <Pencil className="mr-1 h-3.5 w-3.5" />
            {renames ? "Cancel" : "Rename all"}
          </Button>
          <Button
            size="sm"
            variant={rearranging ? "default" : "ghost"}
            onClick={() => {
              setRenames(null);
              setRearranging((v) => !v);
            }}
            className="min-h-9 shrink-0"
          >
            <ArrowUpDown className="mr-1 h-3.5 w-3.5" />
            {rearranging ? "Done" : "Rearrange"}
          </Button>
        </div>
      </div>

      {hasRuns && (
        <p className="mb-3 rounded-md border border-warn/30 bg-warn/10 p-2 text-[11px] text-warn">
          Runs have already been recorded. Renaming is safe, but reordering changes the station
          ladder shown on player cards.
        </p>
      )}

      {renames && (
        <div className="mb-3 space-y-2">
          {stations.map((s, i) => {
            const d = renames[s.id] ?? { name: s.name, short_name: s.short_name ?? "" };
            return (
              <div
                key={s.id}
                className="rounded-md border border-primary/20 bg-white/5 p-2 flex items-center gap-2"
              >
                <span className="w-5 shrink-0 text-center font-display text-sm font-black text-primary">
                  {i + 1}
                </span>
                <Input
                  aria-label={`${s.name} name`}
                  value={d.name}
                  onChange={(e) =>
                    setRenames((prev) => ({ ...prev, [s.id]: { ...d, name: e.target.value } }))
                  }
                  className="h-9 min-w-0 flex-1"
                  placeholder="Tire Flip"
                />
                <Input
                  aria-label={`${s.name} short name`}
                  value={d.short_name}
                  maxLength={20}
                  onChange={(e) =>
                    setRenames((prev) => ({
                      ...prev,
                      [s.id]: { ...d, short_name: e.target.value },
                    }))
                  }
                  className="h-9 w-24 shrink-0 uppercase"
                  placeholder="TIRE"
                />
              </div>
            );
          })}
          <p className="text-[10px] text-muted-foreground">
            Long name shows in the admin lists; the short label is what appears on cards, the ladder
            and the timing buttons.
          </p>
          <Button className="min-h-11 w-full" disabled={busy} onClick={() => void onSaveNames()}>
            {busy ? "Saving…" : "Save all names"}
          </Button>
        </div>
      )}

      <ul className={"space-y-2 " + (renames ? "hidden" : "")}>
        {stations.map((s, i) => (
          <li
            key={s.id}
            className="flex items-center gap-2 rounded-md border border-primary/20 bg-white/5 p-2"
          >
            <button
              type="button"
              disabled={rearranging}
              onClick={() => setDraft(toDraft(s))}
              className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left disabled:opacity-70"
            >
              <span className="w-6 shrink-0 text-center font-display text-sm font-black text-primary">
                {i + 1}
              </span>
              <span className="min-w-0">
                <span className="block truncate font-display text-sm font-bold uppercase">
                  {s.name}
                </span>
                <span className="block truncate text-[10px] uppercase tracking-widest text-muted-foreground">
                  {s.short_name ?? "—"}
                  {!s.active && " · inactive"}
                  {s.penalty_amount_ms > 0 && ` · +${Math.round(s.penalty_amount_ms / 1000)}s pen`}
                </span>
              </span>
            </button>

            {rearranging && (
              <span className="flex shrink-0 items-center gap-1 border-l border-primary/20 pl-2">
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Move ${s.name} up`}
                  disabled={busy || i === 0}
                  onClick={() => void move(i, -1)}
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Move ${s.name} down`}
                  disabled={busy || i === stations.length - 1}
                  onClick={() => void move(i, 1)}
                >
                  <ArrowDown className="h-4 w-4" />
                </Button>
              </span>
            )}
          </li>
        ))}
        {stations.length === 0 && (
          <li className="rounded-md border border-dashed border-primary/20 p-3 text-xs text-muted-foreground">
            No stations yet.
          </li>
        )}
      </ul>

      <Button size="sm" variant="secondary" onClick={onAdd} className="mt-3 min-h-11 w-full">
        <Plus className="mr-1.5 h-4 w-4" /> Add station
      </Button>

      <Sheet open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="font-display uppercase tracking-widest">
              {draft?.id ? "Edit station" : "New station"}
            </SheetTitle>
            <SheetDescription className="text-xs">
              Names show on the timing console, the card back and the station ladder.
            </SheetDescription>
          </SheetHeader>

          {draft && (
            <div className="mt-4 space-y-3">
              <div>
                <Label htmlFor="station-name">Name</Label>
                <Input
                  id="station-name"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="Tire Flip"
                />
              </div>
              <div>
                <Label htmlFor="station-short">Short name</Label>
                <Input
                  id="station-short"
                  value={draft.short_name}
                  maxLength={20}
                  onChange={(e) => setDraft({ ...draft, short_name: e.target.value })}
                  placeholder="TIRE"
                />
              </div>
              <div>
                <Label htmlFor="station-desc">Description</Label>
                <Input
                  id="station-desc"
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="station-pen">Penalty (seconds)</Label>
                <Input
                  id="station-pen"
                  type="number"
                  min={0}
                  value={draft.penalty_seconds}
                  onChange={(e) =>
                    setDraft({ ...draft, penalty_seconds: Number(e.target.value) || 0 })
                  }
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="station-split">Record a split here</Label>
                <Switch
                  id="station-split"
                  checked={draft.split_enabled}
                  onCheckedChange={(v) => setDraft({ ...draft, split_enabled: v })}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="station-active">Active</Label>
                <Switch
                  id="station-active"
                  checked={draft.active}
                  onCheckedChange={(v) => setDraft({ ...draft, active: v })}
                />
              </div>

              <div className="flex gap-2 pt-2">
                <Button
                  onClick={() => void onSaveDraft()}
                  disabled={busy}
                  className="min-h-11 flex-1"
                >
                  {busy ? "Saving…" : "Save"}
                </Button>
                {draft.id && (
                  <Button
                    variant="ghost"
                    disabled={busy}
                    aria-label="Delete station"
                    onClick={() => {
                      const row = stations.find((s) => s.id === draft.id);
                      if (row) void onDelete(row);
                    }}
                    className="min-h-11 text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
              {draft.id && used.has(draft.id) && (
                <p className="text-[11px] text-muted-foreground">
                  This station already has recorded times, so it can’t be deleted. Switch it to
                  inactive to drop it from the timing console.
                </p>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </AdminSection>
  );
}
