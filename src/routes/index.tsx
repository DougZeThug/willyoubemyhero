import { createFileRoute, Link } from "@tanstack/react-router";
import { Radio, Trophy, Users, Timer as TimerIcon } from "lucide-react";
import { useMemo } from "react";
import { useEventBundle } from "@/hooks/use-event-bundle";
import { ParticipantAvatar } from "@/components/participant-avatar";
import { formatTime } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Live — Will YOU Be My Hero? Draft Combine" },
      { name: "description", content: "Watch the Will YOU Be My Hero? Draft Combine live — current runner, timer, and rolling leaderboard." },
      { property: "og:title", content: "Will YOU Be My Hero? Draft Combine — Live" },
      { property: "og:description", content: "Live timing dashboard for the fantasy football draft combine." },
    ],
  }),
  component: LiveDashboard,
});

function LiveDashboard() {
  const { event, bundle, loading } = useEventBundle();

  const { current, next, leaderboard, done, total } = useMemo(() => {
    const parts = bundle?.participants ?? [];
    const runs = bundle?.runs ?? [];
    const runningIdx = parts.findIndex((p) => p.participation_status === "running");
    const upNextIdx = parts.findIndex(
      (p, i) => i > (runningIdx < 0 ? -1 : runningIdx) && p.participation_status !== "finished" && p.participation_status !== "scratched",
    );
    const finished = runs
      .filter((r) => r.is_official)
      .map((r) => {
        const ep = parts.find((p) => p.participant_id === r.participant_id);
        return { run: r, participant: ep?.participant, ep };
      })
      .sort((a, b) => (a.run.official_time_ms ?? 0) - (b.run.official_time_ms ?? 0));
    return {
      current: runningIdx >= 0 ? parts[runningIdx] : null,
      next: upNextIdx >= 0 ? parts[upNextIdx] : null,
      leaderboard: finished.slice(0, 5),
      done: finished.length,
      total: parts.filter((p) => p.participation_status !== "scratched").length,
    };
  }, [bundle]);

  return (
    <div className="field-lines min-h-[calc(100vh-3.25rem)]">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
              </span>
              <span className="text-xs font-bold uppercase tracking-[0.3em] text-primary">
                Live Combine
              </span>
            </div>
            <h1 className="font-display text-3xl font-black uppercase tracking-tight text-foreground sm:text-4xl">
              {event?.name ?? "Loading combine…"}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="gap-1.5">
              <Users className="h-3.5 w-3.5" />
              {done}/{total} done
            </Badge>
            {event?.status && (
              <Badge className="bg-primary/15 text-primary uppercase tracking-widest">
                {event.status.replace(/_/g, " ")}
              </Badge>
            )}
          </div>
        </div>

        {/* Current runner / call to admin */}
        <Card className="overflow-hidden border-primary/40 bg-gradient-to-b from-primary/10 to-transparent">
          <CardContent className="p-6">
            {current ? (
              <div className="grid gap-6 md:grid-cols-[auto_1fr_auto] md:items-center">
                <ParticipantAvatar
                  name={current.participant?.name ?? "?"}
                  photoUrl={current.participant?.profile_image_url ?? null}
                  size={96}
                />
                <div>
                  <div className="text-xs font-bold uppercase tracking-[0.3em] text-primary">
                    On the clock
                  </div>
                  <div className="font-display text-4xl font-black uppercase tracking-tight text-foreground sm:text-5xl">
                    {current.participant?.name}
                  </div>
                  {current.participant?.fantasy_team_name && (
                    <div className="text-sm text-muted-foreground">
                      {current.participant.fantasy_team_name}
                    </div>
                  )}
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Follow along
                  </div>
                  <Link to="/admin" className="text-primary text-sm underline">
                    Timing console →
                  </Link>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <TimerIcon className="h-10 w-10 text-primary" />
                <div className="font-display text-2xl font-black uppercase text-foreground">
                  {loading ? "Loading…" : "No runner on the clock"}
                </div>
                <p className="max-w-md text-sm text-muted-foreground">
                  {done === total && total > 0
                    ? "All athletes are through. Head to the draft board to see the picks."
                    : "Waiting for the next athlete to be sent."}
                </p>
                <div className="flex gap-2">
                  <Button asChild size="sm" variant="secondary">
                    <Link to="/order">Running Order</Link>
                  </Button>
                  <Button asChild size="sm">
                    <Link to="/leaderboard">Leaderboard</Link>
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-2">
          {/* Up next */}
          <Card>
            <CardContent className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-display text-lg font-bold uppercase tracking-wider">Up Next</h2>
                <Radio className="h-4 w-4 text-muted-foreground" />
              </div>
              {next ? (
                <div className="flex items-center gap-3">
                  <ParticipantAvatar
                    name={next.participant?.name ?? "?"}
                    photoUrl={next.participant?.profile_image_url ?? null}
                    size={56}
                  />
                  <div>
                    <div className="font-display text-2xl font-bold uppercase leading-none">
                      {next.participant?.name}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Order #{next.running_order}
                      {next.participant?.trash_talk_quote && (
                        <> — “{next.participant.trash_talk_quote}”</>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No one queued.</p>
              )}
            </CardContent>
          </Card>

          {/* Leaderboard top 5 */}
          <Card>
            <CardContent className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-display text-lg font-bold uppercase tracking-wider">
                  Top 5
                </h2>
                <Trophy className="h-4 w-4 text-primary" />
              </div>
              {leaderboard.length === 0 ? (
                <p className="text-sm text-muted-foreground">No official times yet.</p>
              ) : (
                <ol className="space-y-2">
                  {leaderboard.map((row, i) => (
                    <li
                      key={row.run.id}
                      className="flex items-center gap-3 rounded-md bg-white/5 px-3 py-2"
                    >
                      <span
                        className={
                          "grid h-7 w-7 place-items-center rounded-full text-xs font-black " +
                          (i === 0
                            ? "bg-primary text-primary-foreground"
                            : "bg-white/10 text-foreground")
                        }
                      >
                        {i + 1}
                      </span>
                      <span className="flex-1 truncate font-semibold uppercase tracking-wide">
                        {row.participant?.name ?? "—"}
                      </span>
                      <span className="timer-digits tabular text-primary text-lg">
                        {formatTime(row.run.official_time_ms)}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
              <div className="mt-3 text-right">
                <Link to="/leaderboard" className="text-xs text-primary hover:underline">
                  Full board →
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
