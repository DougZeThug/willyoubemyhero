import { useMemo } from "react";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { cardStats, type StatsBundle } from "@/lib/card-stats";
import type { Rarity } from "@/lib/card-rarity";
import { formatTime, initialsOf } from "@/lib/format";
import { cn } from "@/lib/utils";

export type ComparePlayer = {
  /** event_participant id — what the roster and the route are keyed by. */
  id: string;
  participantId: string;
  name: string;
  rarity: Rarity;
};

/**
 * Head-to-head between two players on the roster.
 *
 * Everything here comes out of the event bundle that's already loaded, through
 * the same `cardStats` the card back and the field breakdown use — so a station
 * a player "wins" here means exactly what it means everywhere else.
 *
 * Two panes rather than one merged table: a combine has few enough stations
 * that the interesting question is "who was faster where", and side-by-side
 * rows answer that without a legend.
 */
export function CardCompare({
  open,
  onOpenChange,
  bundle,
  left,
  right,
  roster,
  onPick,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  bundle: StatsBundle | null | undefined;
  left: ComparePlayer;
  right: ComparePlayer | null;
  roster: ComparePlayer[];
  onPick: (id: string | null) => void;
}) {
  const a = useMemo(() => cardStats(bundle, left.participantId), [bundle, left.participantId]);
  const b = useMemo(() => cardStats(bundle, right?.participantId), [bundle, right?.participantId]);

  // Station rows are keyed off the left player's ladder; both come from the same
  // station list in the same course order, so index alignment is safe.
  const rows = right
    ? a.ladder.map((row, i) => ({
        id: row.id,
        label: row.label,
        aMs: row.ms,
        bMs: b.ladder[i]?.ms ?? null,
      }))
    : [];

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[85dvh]">
        <DrawerHeader>
          <DrawerTitle className="font-display text-lg font-black uppercase tracking-wide">
            {right ? `${left.name} vs ${right.name}` : "Pick someone to compare"}
          </DrawerTitle>
        </DrawerHeader>

        <div className="overflow-y-auto px-4 pb-8">
          {!right ? (
            <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {roster
                .filter((p) => p.id !== left.id)
                .map((p) => (
                  <li key={p.id}>
                    <button
                      onClick={() => onPick(p.id)}
                      className="flex w-full items-center gap-2 rounded-md border border-white/10 bg-white/[0.02] px-2.5 py-2 text-left transition-colors hover:border-primary/40"
                    >
                      <span
                        className="font-display shrink-0 text-xs font-black uppercase"
                        style={{ color: p.rarity.accent }}
                      >
                        {initialsOf(p.name) || "?"}
                      </span>
                      <span className="truncate text-xs text-foreground/90">{p.name}</span>
                    </button>
                  </li>
                ))}
            </ul>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Side player={left} stats={a} />
                <Side player={right} stats={b} />
              </div>

              {rows.length > 0 && (
                <ul className="space-y-1.5">
                  {rows.map((row) => {
                    const aWins = row.aMs != null && (row.bMs == null || row.aMs < row.bMs);
                    const bWins = row.bMs != null && (row.aMs == null || row.bMs < row.aMs);
                    return (
                      <li key={row.id} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                        <span
                          className={cn(
                            "text-right text-xs tabular",
                            aWins ? "font-bold" : "text-muted-foreground",
                          )}
                          style={aWins ? { color: left.rarity.accent } : undefined}
                        >
                          {row.aMs != null ? formatTime(row.aMs) : "—"}
                        </span>
                        <span className="w-24 truncate text-center text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                          {row.label}
                        </span>
                        <span
                          className={cn(
                            "text-xs tabular",
                            bWins ? "font-bold" : "text-muted-foreground",
                          )}
                          style={bWins ? { color: right.rarity.accent } : undefined}
                        >
                          {row.bMs != null ? formatTime(row.bMs) : "—"}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}

              <button
                onClick={() => onPick(null)}
                className="mx-auto block rounded-full border border-white/10 px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.25em] text-muted-foreground hover:border-primary/50 hover:text-primary"
              >
                Pick someone else
              </button>
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function Side({ player, stats }: { player: ComparePlayer; stats: ReturnType<typeof cardStats> }) {
  const wins = stats.ladder.filter((r) => r.best).length;
  return (
    <div
      className="rounded-lg border px-3 py-2 text-center"
      style={{ borderColor: `color-mix(in oklab, ${player.rarity.accent} 40%, transparent)` }}
    >
      <div
        className="font-display truncate text-sm font-black uppercase"
        style={{ color: player.rarity.accent }}
      >
        {player.name}
      </div>
      <div className="timer-digits tabular mt-1 text-xl text-foreground">
        {stats.bestRun ? formatTime(stats.bestRun.official_time_ms) : "—:—"}
      </div>
      <div className="mt-0.5 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
        {stats.rank != null ? `Rank #${stats.rank}` : "No official run"}
        {wins > 0 && ` · ${wins} won`}
      </div>
    </div>
  );
}
