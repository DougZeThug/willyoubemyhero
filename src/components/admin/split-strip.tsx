import { Plus, Redo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatTime } from "@/lib/format";
import type { RunConsole } from "@/hooks/use-run-console";
import { cn } from "@/lib/utils";

/**
 * One button per station, tapped as the athlete clears it, and the Undo beside
 * the heading.
 *
 * The admin console and the Live view's docked bar both time the same run from
 * this strip; `compact` is the bar's shape (a sideways-scrolling row of small
 * cells, no penalties) against the console's grid. What a station button may do
 * is one rule for both: only a station without a split, on a clock that is
 * running — a paused or finished run has `status !== "running"`, so neither
 * records, and neither can undo a finished run, whose record is what Retry save
 * re-sends.
 */
export function SplitStrip({
  runConsole: rc,
  compact = false,
}: {
  runConsole: RunConsole;
  compact?: boolean;
}) {
  const { run, stations, recordSplit, undoLastSplit, addPenalty } = rc;
  if (!run) return null;
  const finished = run.status === "finished";

  const undo = (
    <Button
      size="sm"
      variant="ghost"
      onClick={undoLastSplit}
      disabled={run.splits.length === 0 || finished}
    >
      <Redo2 className="mr-1 h-3.5 w-3.5" /> {compact ? "Undo" : "Undo split"}
    </Button>
  );

  function cell(st: (typeof stations)[number]) {
    const split = run?.splits.find((s) => s.stationId === st.id);
    const disabled = Boolean(split) || run?.status !== "running";
    return (
      <button
        key={compact ? st.id : undefined}
        disabled={disabled}
        onClick={() => recordSplit(st.id)}
        className={cn(
          "rounded-md border text-left transition",
          compact ? "min-w-28 shrink-0 p-2" : "p-3",
          split
            ? "border-primary/40 bg-primary/10"
            : disabled
              ? "border-white/5 bg-white/5 opacity-60"
              : "border-border-strong bg-white/5 hover:border-primary hover:bg-primary/10",
        )}
      >
        {compact ? (
          <div className="truncate font-display text-sm font-black uppercase leading-tight">
            {st.short_name ?? st.name}
          </div>
        ) : (
          <>
            <div className="text-label font-bold uppercase tracking-[0.08em] text-muted-foreground">
              {st.short_name ?? `#${st.station_order}`}
            </div>
            <div className="truncate font-display text-lg font-black uppercase leading-tight">
              {st.name}
            </div>
          </>
        )}
        <div
          className={cn(
            "timer-digits tabular text-primary",
            compact ? "text-sm" : "mt-1 text-base",
          )}
        >
          {split ? formatTime(split.cumulative_time_ms) : "—"}
        </div>
      </button>
    );
  }

  if (compact) {
    return (
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="font-display text-label font-bold uppercase tracking-[0.08em] text-muted-foreground">
            Splits
          </span>
          {undo}
        </div>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {stations.map(cell)}
          {stations.length === 0 && (
            <span className="px-1 py-2 text-xs text-muted-foreground">No stations set up.</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-display text-sm font-bold uppercase tracking-[0.08em] text-muted-foreground">
          Stations & Splits
        </h3>
        {undo}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {stations.map((st) => (
          <div key={st.id} className="flex flex-col gap-1">
            {cell(st)}
            {st.penalty_amount_ms > 0 && (
              <button
                onClick={() => addPenalty(st.id, st.penalty_amount_ms, `${st.name} penalty`)}
                disabled={finished}
                className="min-h-9 rounded-md border border-warn/30 bg-warn/10 py-1 text-label font-bold uppercase tracking-[0.08em] text-warn hover:bg-warn/20 disabled:opacity-50 sm:min-h-0"
              >
                <Plus className="mr-1 inline h-3 w-3" />+{formatTime(st.penalty_amount_ms)} pen
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
