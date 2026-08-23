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
import { updateRunResult } from "@/lib/admin-write.functions";
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

  const stations = bundle?.stations ?? [];
  // The result on the board is the athlete's official run; fall back to their
  // most recent one so a run saved before is_official existed is still editable.
  const run = useMemo(() => {
    const mine = (bundle?.runs ?? []).filter((r) => r.participant_id === participantId);
    return mine.find((r) => r.is_official) ?? mine[mine.length - 1] ?? null;
  }, [bundle?.runs, participantId]);

  const [rawTime, setRawTime] = useState("");
  const [splitTimes, setSplitTimes] = useState<Record<string, string>>({});
  const [penalties, setPenalties] = useState<PenaltyDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reload the draft from the league whenever the sheet is opened, so a stale
  // half-typed correction from last time never overwrites a newer result.
  useEffect(() => {
    if (!open || !run) return;
    setError(null);
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

  const rawMs = parseTime(rawTime);
  const penaltyMs = penalties.reduce((sum, p) => sum + (parseTime(p.ms) ?? 0), 0);
  const badSplit = Object.values(splitTimes).some((v) => v.trim() !== "" && parseTime(v) == null);
  const badPenalty = penalties.some((p) => parseTime(p.ms) == null);
  const valid = rawMs != null && !badSplit && !badPenalty;

  async function onSave() {
    if (!run || rawMs == null || !valid) return;
    setSaving(true);
    setError(null);
    try {
      await saveFn({
        data: {
          eventId,
          runId: run.id,
          raw_time_ms: rawMs,
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
        },
      });
      await qc.invalidateQueries({ queryKey: ["event-bundle", eventId] });
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The edit did not save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[92vh] overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle className="font-display uppercase">Edit result</SheetTitle>
          <SheetDescription>
            {participantName} — times as <span className="tabular">m:ss.hh</span> or{" "}
            <span className="tabular">ss.hh</span>.
          </SheetDescription>
        </SheetHeader>

        {!run ? (
          <p className="p-4 text-sm text-muted-foreground">
            No saved run for this athlete yet — time them first.
          </p>
        ) : (
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
                onChange={(e) => setRawTime(e.target.value)}
                className={"tabular " + (rawMs == null ? "border-destructive" : "")}
                placeholder="1:23.45"
              />
            </div>

            <div>
              <div className="mb-1 font-display text-[10px] font-bold uppercase tracking-[0.28em] text-muted-foreground">
                Splits
              </div>
              <div className="space-y-2">
                {stations.map((st) => {
                  const value = splitTimes[st.id] ?? "";
                  const bad = value.trim() !== "" && parseTime(value) == null;
                  return (
                    <div key={st.id} className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-xs uppercase">
                        {st.short_name ?? st.name}
                      </span>
                      <Input
                        aria-label={`${st.name} split`}
                        inputMode="decimal"
                        value={value}
                        onChange={(e) =>
                          setSplitTimes((prev) => ({ ...prev, [st.id]: e.target.value }))
                        }
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
              <Save className="mr-2 h-4 w-4" /> {saving ? "Saving…" : "Save result"}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
