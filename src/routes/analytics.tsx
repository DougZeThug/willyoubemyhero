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
    const byStation = new Map<string, number[]>();
    for (const s of bundle.splits) {
      const st = bundle.stations.find((x) => x.id === s.station_id);
      if (!st) continue;
      const arr = byStation.get(st.name) ?? [];
      arr.push(s.segment_time_ms ?? 0);
      byStation.set(st.name, arr);
    }
    return bundle.stations.map((st) => {
      const arr = byStation.get(st.name) ?? [];
      const avg = arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
      const best = arr.length ? Math.min(...arr) : 0;
      return {
        name: st.name,
        avgSec: +(avg / 1000).toFixed(2),
        bestSec: +(best / 1000).toFixed(2),
      };
    });
  }, [bundle]);

  const bests = useMemo(() => {
    if (!bundle) return [];
    return bundle.participants
      .map((ep) => {
        const runs = bundle.runs.filter(
          (r) => r.participant_id === ep.participant_id && r.is_official,
        );
        if (!runs.length) return null;
        const best = Math.min(...runs.map((r) => r.official_time_ms ?? Infinity));
        return { name: ep.participant?.name ?? "?", bestMs: best };
      })
      .filter((x): x is { name: string; bestMs: number } => !!x)
      .sort((a, b) => a.bestMs - b.bestMs)
      .slice(0, 10);
  }, [bundle]);

  // A pending fetch, a failed read and a combine nobody has run all used to
  // render the same "No split data yet." — the exact failure the live screen
  // was given feed-state.tsx for.
  if (loading && !bundle) {
    return (
      <div className="circuit-bg min-h-[calc(100vh-4.5rem)] px-4 py-6">
        <div className="mx-auto max-w-3xl">
          <FeedLoading label="Reading the splits…" />
        </div>
      </div>
    );
  }

  if (error && !bundle) {
    return (
      <div className="circuit-bg min-h-[calc(100vh-4.5rem)] px-4 py-6">
        <div className="mx-auto max-w-3xl">
          <FeedError message={error.message} onRetry={() => void refetch()} />
        </div>
      </div>
    );
  }

  return (
    <div className="circuit-bg min-h-[calc(100vh-4.5rem)] px-4 py-6">
      <div className="mx-auto max-w-3xl space-y-4">
        {(realtimeDegraded || !!error) && <FeedDegradedBanner />}
        <header>
          <div className="font-display text-[10px] font-black uppercase tracking-[0.4em] text-primary">
            Analytics
          </div>
          <h1 className="font-display text-3xl font-black uppercase leading-none">
            Splits & Records
          </h1>
        </header>

        <Card className="hud-bezel border-primary/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm uppercase tracking-widest text-primary/80">
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
                      formatter={(v: number) => `${v}s`}
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
            <CardTitle className="text-sm uppercase tracking-widest text-primary/80">
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
                {bests.map((b, i) => (
                  <li
                    key={b.name}
                    className="flex items-center gap-3 rounded-md bg-[oklch(0.16_0.02_240)] px-3 py-2"
                  >
                    <span className="grid h-6 w-6 place-items-center rounded-full bg-primary/15 text-[10px] font-black text-primary">
                      {i + 1}
                    </span>
                    <span className="flex-1 truncate text-sm font-semibold uppercase tracking-wide">
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
            <CardTitle className="text-sm uppercase tracking-widest text-primary/80">
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
                      className="flex items-center justify-between rounded-md border border-primary/10 bg-[oklch(0.16_0.02_240)] px-3 py-2 text-sm hover:border-primary/40"
                    >
                      <span className="font-semibold uppercase tracking-wide">
                        {a.event_name} {a.event_year ?? ""}
                      </span>
                      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
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
