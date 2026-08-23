/**
 * Fixing a result after the fact.
 *
 * The stopwatch is tapped by a human holding a beer, so results get typed in
 * wrong, splits get missed and penalties get argued down an hour later. Before
 * this the only remedy was deleting the athlete's run and re-timing them.
 *
 * Everything is entered as `m:ss.hh` — the same shape the app prints — and the
 * sheet sends the complete intended set of splits and penalties, so clearing a
 * station's field deletes that split.
 */
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useEventBundle } from "@/hooks/use-event-bundle";
import { createManualRun, deleteRunResult, updateRunResult } from "@/lib/admin-write.functions";
import { formatTime, parseTime } from "@/lib/format";

type PenaltyDraft = { stationId: string; ms: string; reason: string };

function timeField(ms: number | null | undefined): string {
  return ms == null ? "" : formatTime(ms).replace("—", "");
}

export function EditResultSheet({
  eventId,
  participantId,
  participantName,
  open,
  onOpenChange,
}: {
  eventId: string;
  participantId: string;
  participantName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { bundle } = useEventBundle();
  const qc = useQueryClient();
  const saveFn = useServerFn(updateRunResult);
  const createFn = useServerFn(createManualRun);
  const deleteFn = useServerFn(deleteRunResult);

  // Memoised: the leg maths below depends on this list, and a fresh array every
  // render would recompute (and re-render) on every keystroke.
  const stations = useMemo(() => bundle?.stations ?? [], [bundle?.stations]);
  // The result on the board is the athlete's official run; fall back to their
  // most recent one so a run saved before is_official existed is still editable.
  const run = useMemo(() => {
    const mine = (bundle?.runs ?? []).filter((r) => r.participant_id === participantId);
    return mine.find((r) => r.is_official) ?? mine[mine.length - 1] ?? null;
  }, [bundle?.runs, participantId]);
  // No run yet means this is a hand-entered result rather than a correction.
  const creating = !run;

  const [rawTime, setRawTime] = useState("");
  // Once the admin types a course time by hand it wins: auto-fill from the
  // splits would otherwise fight them mid-correction.
  const [courseTouched, setCourseTouched] = useState(false);
  const [splitTimes, setSplitTimes] = useState<Record<string, string>>({});
  const [penalties, setPenalties] = useState<PenaltyDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reload the draft from the league whenever the sheet is opened, so a stale
  // half-typed correction from last time never overwrites a newer result.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setCourseTouched(false);
    if (!run) {
      setRawTime("");
      setSplitTimes({});
      setPenalties([]);
      return;
    }
    setRawTime(timeField(run.raw_time_ms));
    const splits: Record<string, string> = {};
    for (const s of bundle?.splits ?? []) {
      if (s.run_id === run.id && s.station_id) {
        splits[s.station_id] = timeField(s.cumulative_time_ms);
      }
    }
    setSplitTimes(splits);
    setPenalties(
      (bundle?.penalties ?? [])
        .filter((p) => p.run_id === run.id)
        .map((p) => ({
          stationId: p.station_id ?? "",
          ms: timeField(p.penalty_ms),
          reason: p.reason ?? "",
        })),
    );
    // Only re-seed on open / run change: retyping mid-edit would fight the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, run?.id]);

  // Splits are stored cumulatively, so the legs added together are just the
  // last cumulative split — that is the course time the splits imply.
  const legs = useMemo(() => {
    let prev = 0;
    return stations.map((st) => {
      const value = splitTimes[st.id] ?? "";
      const ms = value.trim() === "" ? null : parseTime(value);
      if (ms == null) return { id: st.id, ms: null as number | null, leg: null as number | null };
      const leg = ms - prev;
      prev = ms;
      return { id: st.id, ms, leg };
    });
  }, [stations, splitTimes]);

  const splitDerivedMs = useMemo(() => {
    const times = legs.map((l) => l.ms).filter((ms): ms is number => ms != null);
    return times.length ? Math.max(...times) : null;
  }, [legs]);

  // Auto-fill the course time from the splits until the admin overrides it.
  useEffect(() => {
    if (!open || courseTouched || splitDerivedMs == null) return;
    const next = timeField(splitDerivedMs);
    setRawTime((prev) => (prev === next ? prev : next));
  }, [open, courseTouched, splitDerivedMs]);

  // Snapshot of the splits when the admin entered a field. Every keystroke is
  // measured against this, not against the previous keystroke — otherwise
  // typing "58.57" over "43.21" would shift the later stations once per
  // character and send them minutes into the future.
  const baseline = useRef<{ stationId: string; splits: Record<string, string> } | null>(null);

  // Splits are cumulative, so correcting one station also moves every station
  // after it: their legs are still right, they just start later. Without this
  // the final split — and so the official time — never budges after a fix.
  function setSplitAt(stationId: string, value: string) {
    const base = baseline.current?.stationId === stationId ? baseline.current.splits : null;
    setSplitTimes((prev) => {
      const source = base ?? prev;
      const next = { ...prev, [stationId]: value };
      const before = parseTime(source[stationId] ?? "");
      const after = parseTime(value);
      if (before == null || after == null) return next;
      const delta = after - before;
      const idx = stations.findIndex((st) => st.id === stationId);
      if (idx < 0) return next;
      for (const st of stations.slice(idx + 1)) {
        const cur = source[st.id];
        const ms = cur == null || cur.trim() === "" ? null : parseTime(cur);
        if (ms == null) continue;
        next[st.id] = timeField(Math.max(0, ms + delta));
      }
      return next;
    });
  }

  const rawMs = parseTime(rawTime);
  const penaltyMs = penalties.reduce((sum, p) => sum + (parseTime(p.ms) ?? 0), 0);
  const badSplit = Object.values(splitTimes).some((v) => v.trim() !== "" && parseTime(v) == null);
  const badPenalty = penalties.some((p) => parseTime(p.ms) == null);
  const valid = rawMs != null && !badSplit && !badPenalty;

  const payload = () => ({
    splits: Object.entries(splitTimes)
      .map(([stationId, value]) => ({
        stationId,
        cumulative_time_ms: parseTime(value) ?? -1,
      }))
      .filter((s) => s.cumulative_time_ms >= 0),
    penalties: penalties.map((p) => ({
      stationId: p.stationId || null,
      penalty_ms: parseTime(p.ms) ?? 0,
      reason: p.reason.trim() || null,
    })),
  });

  async function onSave() {
    if (rawMs == null || !valid) return;
    setSaving(true);
    setError(null);
    try {
      if (run) {
        await saveFn({
          data: { eventId, runId: run.id, raw_time_ms: rawMs, ...payload() },
        });
      } else {
        await createFn({
          data: { eventId, participantId, raw_time_ms: rawMs, ...payload() },
        });
      }
      await qc.invalidateQueries({ queryKey: ["event-bundle", eventId] });
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The edit did not save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!run) return;
    if (!confirm(`Delete ${participantName}'s result? Their splits and penalties go with it.`)) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await deleteFn({ data: { eventId, runId: run.id } });
      await qc.invalidateQueries({ queryKey: ["event-bundle", eventId] });
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The delete did not go through. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[92vh] overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle className="font-display uppercase">
            {creating ? "Add result" : "Edit result"}
          </SheetTitle>
          <SheetDescription>
            {participantName} — times as <span className="tabular">m:ss.hh</span> or{" "}
            <span className="tabular">ss.hh</span>.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 p-4">
          <div>
            <label
              htmlFor="raw-time"
              className="mb-1 block font-display text-[10px] font-bold uppercase tracking-[0.28em] text-muted-foreground"
            >
              Course time (before penalties)
            </label>
            <Input
              id="raw-time"
              inputMode="decimal"
              value={rawTime}
              onChange={(e) => {
                setCourseTouched(true);
                setRawTime(e.target.value);
              }}
              className={"tabular " + (rawMs == null ? "border-destructive" : "")}
              placeholder="1:23.45"
            />
            {splitDerivedMs != null && rawMs != null && rawMs !== splitDerivedMs && (
              <p className="mt-1 text-[10px] text-warn">
                From splits: <span className="tabular">{formatTime(splitDerivedMs)}</span> — your
                typed time is being used instead.
              </p>
            )}
          </div>

          <div>
            <div className="mb-1 font-display text-[10px] font-bold uppercase tracking-[0.28em] text-muted-foreground">
              Splits
            </div>
            <div className="space-y-2">
              {stations.map((st) => {
                const value = splitTimes[st.id] ?? "";
                const bad = value.trim() !== "" && parseTime(value) == null;
                const leg = legs.find((l) => l.id === st.id)?.leg ?? null;
                return (
                  <div key={st.id} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-xs uppercase">
                      {st.short_name ?? st.name}
                    </span>
                    {leg != null && (
                      <span
                        className={
                          "shrink-0 text-[10px] tabular " +
                          (leg < 0 ? "text-destructive" : "text-muted-foreground")
                        }
                      >
                        {leg < 0 ? "out of order" : `+${formatTime(leg)}`}
                      </span>
                    )}
                    <Input
                      aria-label={`${st.name} split`}
                      inputMode="decimal"
                      value={value}
                      onChange={(e) => setSplitAt(st.id, e.target.value)}
                      placeholder="—"
                      className={"h-9 w-28 tabular " + (bad ? "border-destructive" : "")}
                    />
                  </div>
                );
              })}
              {stations.length === 0 && (
                <p className="text-xs text-muted-foreground">No stations set up.</p>
              )}
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Leave a station blank to remove its split.
            </p>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="font-display text-[10px] font-bold uppercase tracking-[0.28em] text-muted-foreground">
                Penalties
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  setPenalties((prev) => [...prev, { stationId: "", ms: "5.00", reason: "" }])
                }
              >
                <Plus className="mr-1 h-3.5 w-3.5" /> Add
              </Button>
            </div>
            <div className="space-y-2">
              {penalties.map((p, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select
                    aria-label="Penalty station"
                    value={p.stationId}
                    onChange={(e) =>
                      setPenalties((prev) =>
                        prev.map((row, j) =>
                          j === i ? { ...row, stationId: e.target.value } : row,
                        ),
                      )
                    }
                    className="min-w-0 flex-1 rounded-md border border-white/10 bg-white/5 px-2 py-2 text-xs uppercase"
                  >
                    <option value="">No station</option>
                    {stations.map((st) => (
                      <option key={st.id} value={st.id}>
                        {st.short_name ?? st.name}
                      </option>
                    ))}
                  </select>
                  <Input
                    aria-label="Penalty time"
                    inputMode="decimal"
                    value={p.ms}
                    onChange={(e) =>
                      setPenalties((prev) =>
                        prev.map((row, j) => (j === i ? { ...row, ms: e.target.value } : row)),
                      )
                    }
                    className={
                      "h-9 w-24 tabular " + (parseTime(p.ms) == null ? "border-destructive" : "")
                    }
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Remove penalty"
                    className="h-9 shrink-0 px-2 text-destructive hover:bg-destructive/10"
                    onClick={() => setPenalties((prev) => prev.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              {penalties.length === 0 && (
                <p className="text-xs text-muted-foreground">Clean run — no penalties.</p>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border border-primary/30 bg-primary/[0.06] px-3 py-2">
            <span className="text-[10px] uppercase tracking-[0.28em] text-muted-foreground">
              Official time
            </span>
            <span className="timer-digits tabular text-lg text-primary">
              {rawMs == null ? "—" : formatTime(rawMs + penaltyMs)}
            </span>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <Button className="h-12 w-full" disabled={!valid || saving} onClick={onSave}>
            <Save className="mr-2 h-4 w-4" />
            {saving ? "Saving…" : creating ? "Add result" : "Save result"}
          </Button>

          {run && (
            <Button
              variant="ghost"
              className="w-full text-destructive hover:bg-destructive/10"
              disabled={saving}
              onClick={onDelete}
            >
              <Trash2 className="mr-2 h-4 w-4" /> Delete this result
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
