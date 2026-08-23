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
import { useEffect, useMemo, useRef, useState } from "react";
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
  if (ms == null) return "";
  // The boxes only carry hundredths, so a stored value with stray milliseconds
  // has to land on the nearest hundredth rather than being truncated: opening a
  // result and saving it untouched would otherwise shave time off every leg.
  return formatTime(Math.round(ms / 10) * 10).replace("—", "");
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
  // A saved run already has a course time; only start deriving it from the legs
  // once the admin actually changes a station, otherwise the hundredth-rounding
  // of the seeded legs would silently rewrite the stored time on open.
  const [legsTouched, setLegsTouched] = useState(false);
  // Per-station times, not cumulative clock times: an admin thinks "cornhole
  // took 43 seconds", not "the clock read 58.57 when he left it". They are
  // converted back to cumulative splits on save.
  const [legTimes, setLegTimes] = useState<Record<string, string>>({});
  const [penalties, setPenalties] = useState<PenaltyDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reload the draft from the league whenever the sheet is opened, so a stale
  // half-typed correction from last time never overwrites a newer result.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setCourseTouched(false);
    setLegsTouched(false);
    if (!run) {
      setRawTime("");
      setLegTimes({});
      setPenalties([]);
      return;
    }
    setRawTime(timeField(run.raw_time_ms));
    const cumulative: Record<string, number> = {};
    for (const s of bundle?.splits ?? []) {
      if (s.run_id === run.id && s.station_id && s.cumulative_time_ms != null) {
        cumulative[s.station_id] = s.cumulative_time_ms;
      }
    }
    // Stored splits are cumulative; show the gap from the previous recorded
    // station so each box reads as that station's own time. Round each
    // cumulative onto the hundredth grid *before* differencing — rounding the
    // gaps instead lets each leg round up independently, and six of those add a
    // hundredth to the total every time the sheet is opened.
    const seeded: Record<string, string> = {};
    let prev = 0;
    for (const st of stations) {
      const ms = cumulative[st.id];
      if (ms == null) continue;
      const at = Math.round(ms / 10) * 10;
      seeded[st.id] = timeField(Math.max(0, at - prev));
      prev = at;
    }
    setLegTimes(seeded);
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

  // Run the per-station times forward into the cumulative clock the database
  // stores and the card back prints. Blank stations contribute nothing.
  const cumulatives = useMemo(() => {
    let total = 0;
    return stations.map((st) => {
      const value = legTimes[st.id] ?? "";
      const leg = value.trim() === "" ? null : parseTime(value);
      if (leg == null) return { id: st.id, leg: null as number | null, at: null as number | null };
      total += leg;
      return { id: st.id, leg, at: total };
    });
  }, [stations, legTimes]);

  const splitDerivedMs = useMemo(() => {
    const last = [...cumulatives].reverse().find((c) => c.at != null);
    return last?.at ?? null;
  }, [cumulatives]);

  // Auto-fill the course time from the splits until the admin overrides it.
  // A saved run keeps its stored time until a station is actually edited.
  useEffect(() => {
    if (!open || courseTouched || splitDerivedMs == null) return;
    if (run && !legsTouched) return;
    const next = timeField(splitDerivedMs);
    setRawTime((prev) => (prev === next ? prev : next));
  }, [open, courseTouched, splitDerivedMs, run, legsTouched]);

  const rawMs = parseTime(rawTime);
  const penaltyMs = penalties.reduce((sum, p) => sum + (parseTime(p.ms) ?? 0), 0);
  const badSplit = Object.values(legTimes).some((v) => v.trim() !== "" && parseTime(v) == null);
  const badPenalty = penalties.some((p) => parseTime(p.ms) == null);
  const valid = rawMs != null && !badSplit && !badPenalty;

  const payload = () => ({
    splits: cumulatives
      .filter((c): c is { id: string; leg: number; at: number } => c.at != null)
      .map((c) => ({ stationId: c.id, cumulative_time_ms: c.at })),
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
              Station times
            </div>
            <div className="space-y-2">
              {stations.map((st) => {
                const value = legTimes[st.id] ?? "";
                const parsed = value.trim() === "" ? null : parseTime(value);
                const bad = value.trim() !== "" && (parsed == null || parsed < 0);
                const at = cumulatives.find((c) => c.id === st.id)?.at ?? null;
                return (
                  <div key={st.id} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-xs uppercase">
                      {st.short_name ?? st.name}
                    </span>
                    {at != null && (
                      <span className="shrink-0 text-[10px] tabular text-muted-foreground">
                        at {formatTime(at)}
                      </span>
                    )}
                    <Input
                      aria-label={`${st.name} time`}
                      inputMode="decimal"
                      value={value}
                      onChange={(e) => {
                        setLegsTouched(true);
                        setLegTimes((prev) => ({ ...prev, [st.id]: e.target.value }));
                      }}
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
              Type how long each station took — the running clock beside it updates as you go. Leave
              a station blank to remove its split.
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
