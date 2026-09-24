import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { useEventBundle } from "@/hooks/use-event-bundle";
import { listArchives } from "@/lib/media.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatTime } from "@/lib/format";
import { standings } from "@/lib/standings";
import { FeedDegradedBanner, FeedError, FeedLoading } from "@/components/feed-state";

export const Route = createFileRoute("/analytics")({
  head: () => ({
    meta: [
      { title: "Analytics — Draft Combine" },
      {
        name: "description",
        content: "Split analysis, personal bests, and historical event archive.",
      },
      { property: "og:title", content: "Draft Combine — Analytics" },
      { property: "og:description", content: "Combine splits, personal bests, and archive." },
    ],
  }),
  component: AnalyticsPage,
});

function AnalyticsPage() {
  const { bundle, loading, error, failedTables, realtimeDegraded, refetch } = useEventBundle();
  const listFn = useServerFn(listArchives);
  const archives = useQuery({ queryKey: ["archives"], queryFn: () => listFn(), staleTime: 60_000 });

  const stationAverages = useMemo(() => {
    if (!bundle) return [];
    // With no splits — whether the read failed and coalesced to [] or the
    // event genuinely has none — the loop below can only produce zero-value
    // bars. Return empty so the render falls through to the error/empty
    // message instead.
    if (!bundle.splits.length) return [];
    const byStation = new Map<string, number[]>();
    for (const s of bundle.splits) {
      // A missing segment_time_ms is a measurement never taken, not a
      // zero-second segment. At 0 it drags the mean down AND wins Math.min
      // outright, so one unmeasured split made the whole station's "Best" bar
      // read 0.00s. card-rarity.ts and card-stats.ts skip them for the same
      // reason; this was the one place that did not.
      if (s.segment_time_ms == null) continue;
      const st = bundle.stations.find((x) => x.id === s.station_id);
      if (!st) continue;
      // Keyed by id, not by name. Nothing stops two stations in one event
      // sharing a name -- no unique index on stations.name, and neither
      // upsertStation nor the admin panel checks for one -- and by name their
      // splits pooled into a single bucket. The map below still emits a row per
      // station, so both rows then read the SAME merged average and the same
      // global minimum: two identical bars, an average that is no station's, and
      // a slow station credited with a best it never produced. `bests` below
      // learned this about athletes called Dave.
      const arr = byStation.get(st.id) ?? [];
      arr.push(s.segment_time_ms);
      byStation.set(st.id, arr);
    }
    // Splits that were all unmeasured, or that name stations this event does
    // not have, leave nothing to plot — the same nothing as no splits at all,
    // so say so rather than drawing a row of zero bars.
    if (byStation.size === 0) return [];
    // And the same holds one station at a time. A station nobody reached — the
    // field DNF'd before it, or it was set up and never run — has no bucket, and
    // falling back to 0 drew a 0.00s "Best" beside real ones: on the archive,
    // the fastest time anybody ran anywhere.
    return bundle.stations
      .filter((st) => byStation.has(st.id))
      .map((st) => {
        const arr = byStation.get(st.id)!;
        const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
        const best = Math.min(...arr);
        return {
          name: st.name,
          avgSec: +(avg / 1000).toFixed(2),
          bestSec: +(best / 1000).toFixed(2),
        };
      });
  }, [bundle]);

  // The board's own rows, so these ten names are ten off the leaderboard. Reducing
  // official runs per athlete asked nothing about contention, so a scratched
  // athlete could hold the #1 personal best on a screen whose sibling had already
  // dropped them -- two public pages naming a different fastest athlete off one
  // bundle. It also kept somebody whose only official run has no time yet, parked
  // at Infinity with an em dash where their time belongs.
  const bests = useMemo(() => {
    const parts = bundle?.participants ?? [];
    return standings(bundle)
      .slice(0, 10)
      .map((s) => ({
        participantId: s.participantId,
        place: s.place,
        name: parts.find((p) => p.participant_id === s.participantId)?.participant?.name ?? "?",
        bestMs: s.run.official_time_ms,
      }));
  }, [bundle]);

  // A pending fetch, a failed read and a combine nobody has run all used to
  // render the same "No split data yet." — the exact failure the live screen
  // was given feed-state.tsx for.
  if (loading && !bundle) {
    return (
      <div className="circuit-bg min-h-[var(--page-min-h)] px-4 py-6">
        <div className="mx-auto max-w-3xl">
          <FeedLoading label="Reading the splits…" />
        </div>
      </div>
    );
  }

  if (error && !bundle) {
    return (
      <div className="circuit-bg min-h-[var(--page-min-h)] px-4 py-6">
        <div className="mx-auto max-w-3xl">
          <FeedError message={error.message} onRetry={() => void refetch()} />
        </div>
      </div>
    );
  }

  return (
    <div className="circuit-bg min-h-[var(--page-min-h)] px-4 py-6">
      <div className="mx-auto max-w-3xl space-y-4">
        {(realtimeDegraded || !!error) && <FeedDegradedBanner />}
        <header>
          <div className="font-display text-label font-black uppercase tracking-[0.08em] text-primary">
            Analytics
          </div>
          <h1 className="font-display text-3xl font-black uppercase leading-none">
            Splits & Records
          </h1>
        </header>

        <Card className="hud-bezel border-primary/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm uppercase tracking-[0.08em] text-primary/80">
              Average Split by Station
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {stationAverages.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {failedTables.includes("splits") || failedTables.includes("stations")
                  ? "Couldn't read the splits just now — retrying."
                  : "No split data yet."}
              </p>
            ) : (
              <div className="h-56 w-full">
                <ResponsiveContainer>
                  <BarChart
                    data={stationAverages}
                    margin={{ top: 8, right: 8, bottom: 8, left: -8 }}
                  >
                    <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                    <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} />
                    <YAxis stroke="#94a3b8" fontSize={11} unit="s" />
                    <Tooltip
                      contentStyle={{
                        background: "#0f172a",
                        border: "1px solid #38bdf8",
                        borderRadius: 8,
                      }}
                      labelStyle={{ color: "#67e8f9" }}
                      formatter={(v) => `${v}s`}
                    />
                    <Bar dataKey="avgSec" fill="#38bdf8" radius={[6, 6, 0, 0]} name="Average" />
                    <Bar dataKey="bestSec" fill="#22d3ee" radius={[6, 6, 0, 0]} name="Best" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="hud-bezel border-primary/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm uppercase tracking-[0.08em] text-primary/80">
              Personal Bests
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {bests.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {failedTables.includes("runs") || failedTables.includes("event_participants")
                  ? "Couldn't read the results just now — retrying."
                  : "No official finishes yet."}
              </p>
            ) : (
              <ol className="space-y-1.5">
                {bests.map((b) => (
                  <li
                    // The participant, not the name: two athletes called Dave
                    // collided, and this list re-renders on every realtime nudge,
                    // which is where an undefined reconciliation goes wrong.
                    key={b.participantId}
                    className="flex items-center gap-3 rounded-md bg-[oklch(0.16_0.02_240)] px-3 py-2"
                  >
                    <span className="grid h-6 w-6 place-items-center rounded-full bg-primary/15 text-label font-black text-primary">
                      {b.place}
                    </span>
                    <span className="flex-1 line-clamp-2 text-sm font-semibold uppercase tracking-wide">
                      {b.name}
                    </span>
                    <span className="timer-digits text-primary">{formatTime(b.bestMs)}</span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        <Card className="hud-bezel border-primary/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm uppercase tracking-[0.08em] text-primary/80">
              Archive
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {!archives.data?.length ? (
              <p className="text-xs text-muted-foreground">No archived events yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {archives.data.map((a) => (
                  <li key={a.id}>
                    <Link
                      to="/recap/$slug"
                      params={{ slug: a.slug }}
                      className="flex min-h-11 items-center justify-between rounded-md border border-primary/50 bg-[oklch(0.16_0.02_240)] px-3 py-2 text-sm hover:border-primary"
                    >
                      <span className="font-semibold uppercase tracking-wide">
                        {a.event_name} {a.event_year ?? ""}
                      </span>
                      <span className="text-label uppercase tracking-[0.08em] text-muted-foreground">
                        {new Date(a.created_at).toLocaleDateString()}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// The test files in this folder import the page component as the module's
// default. Route files normally export only `Route`, so re-export the
// component explicitly to keep those imports typed and resolvable.
export default AnalyticsPage;
