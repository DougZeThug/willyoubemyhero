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
import { stationSplitStats } from "@/lib/card-stats";
import { standingsRows } from "@/hooks/use-standings-rows";
import {
  FeedDegradedBanner,
  FeedError,
  FeedLoading,
  FeedPartialBanner,
} from "@/components/feed-state";
import { feedReadError, readFailedMessage } from "@/lib/feed-read";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

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
  const read = feedReadError(failedTables);
  const listFn = useServerFn(listArchives);
  const archives = useQuery({ queryKey: ["archives"], queryFn: () => listFn(), staleTime: 60_000 });

  const stationAverages = useMemo(() => stationSplitStats(bundle), [bundle]);

  // The board's own rows, so these ten names are ten off the leaderboard. Reducing
  // official runs per athlete asked nothing about contention, so a scratched
  // athlete could hold the #1 personal best on a screen whose sibling had already
  // dropped them -- two public pages naming a different fastest athlete off one
  // bundle. It also kept somebody whose only official run has no time yet, parked
  // at Infinity with an em dash where their time belongs.
  const bests = useMemo(() => {
    return standingsRows(bundle)
      .slice(0, 10)
      .map(({ run, place, ep }) => ({
        participantId: run.participant_id,
        place,
        name: ep?.participant?.name ?? "?",
        bestMs: run.official_time_ms,
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
                {read.splits ? readFailedMessage("splits") : "No split data yet."}
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
                {read.runs || read.roster
                  ? readFailedMessage("results")
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
                    className="flex items-center gap-3 rounded-md bg-panel px-3 py-2"
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
            {/* A failed read, a pending one and a combine nobody has archived used
                to render the same "No archived events yet." */}
            {/* Nothing to show covers a cached [] too: after an empty read, a failed
                refetch leaves data at [] and must not pass for "never archived". */}
            {archives.isError && !archives.data?.length ? (
              <div className="flex flex-col items-start gap-2">
                <p className="text-xs text-muted-foreground">
                  Couldn&apos;t read the archive just now.
                </p>
                <Button
                  size="default"
                  variant="secondary"
                  className="min-h-11"
                  onClick={() => void archives.refetch()}
                >
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Try again
                </Button>
              </div>
            ) : !archives.data?.length ? (
              <p className="text-xs text-muted-foreground">
                {archives.isPending ? "Reading the archive…" : "No archived events yet."}
              </p>
            ) : (
              <ul className="space-y-1.5">
                {/* Stale rows are kept when a refetch fails, which would otherwise
                    pass for a fresh list. */}
                {archives.isError && (
                  <li className="list-none">
                    <FeedPartialBanner message="Couldn't refresh the archive — showing what we had." />
                  </li>
                )}
                {archives.data.map((a) => (
                  <li key={a.id}>
                    <Link
                      to="/recap/$slug"
                      params={{ slug: a.slug }}
                      className="flex min-h-11 items-center justify-between rounded-md border border-primary/50 bg-panel px-3 py-2 text-sm hover:border-primary"
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
