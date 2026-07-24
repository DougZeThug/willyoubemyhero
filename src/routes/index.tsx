import { createFileRoute, Link } from "@tanstack/react-router";
import { Trophy, Radio, User2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useEventBundle } from "@/hooks/use-event-bundle";
import { useEventPhotoUrls } from "@/hooks/use-photo-urls";
import { useFinishWatcher } from "@/hooks/use-finish-watcher";
import { ParticipantAvatar } from "@/components/participant-avatar";
import { HudTimer } from "@/components/hud-timer";
import { FinishCelebration } from "@/components/finish-celebration";
import { formatTime } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";

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
  const photos = useEventPhotoUrls(event?.id ?? null);
  const [celebration, setCelebration] = useState<{ name: string; timeMs: number; deltaMs: number } | null>(null);
  useFinishWatcher(bundle, (f) => setCelebration(f));

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

  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const currentTimer = current ? 0 : 0; // Live-side spectators see 00:00 until admin starts.

  return (
    <div className="circuit-bg min-h-[calc(100vh-4.5rem)]">
      <div className="mx-auto max-w-6xl space-y-6 px-4 pb-6 pt-4 sm:pt-6">
        {/* Progress + heartbeat */}
        <div>
          <div className="relative flex items-center gap-2 rounded-full border border-primary/40 bg-[oklch(0.16_0.02_240)] p-1 shadow-[inset_0_0_0_1px_oklch(1_0_0_/_0.04),0_0_20px_oklch(0.82_0.14_210_/_0.15)]">
            <div className="relative h-4 flex-1 overflow-hidden rounded-full bg-[oklch(0.1_0.015_240)]">
              <div
                className="progress-hatched h-full rounded-full transition-[width] duration-500 shadow-[0_0_12px_var(--color-primary)]"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="flex shrink-0 items-center gap-1.5 pr-3">
              <Heartbeat />
              <span className="timer-digits text-primary text-sm">{pct}%</span>
            </div>
          </div>
          <div className="mt-2 text-center text-[11px] font-bold uppercase tracking-[0.32em] text-muted-foreground">
            {done}/{total} athletes completed
          </div>
        </div>

        {/* Hero HUD */}
        <div className="flex flex-col items-center">
          <HudTimer
            runningSinceMs={currentTimer}
            paused={!current}
            status={current ? "On the Clock" : loading ? "Loading" : "On Deck"}
            size={320}
          >
            {current ? (
              <ParticipantAvatar
                name={current.participant?.name ?? "?"}
                photoUrl={photos.data?.[current.id] ?? current.participant?.profile_image_url ?? null}
                size={200}
                className="opacity-70"
              />
            ) : (
              <User2 className="h-40 w-40 text-primary/60" strokeWidth={1.25} />
            )}
          </HudTimer>

          {current ? (
            <div className="mt-4 text-center">
              <div className="font-display text-2xl font-black uppercase tracking-wide text-foreground">
                {current.participant?.name}
              </div>
              {current.participant?.fantasy_team_name && (
                <div className="text-xs text-muted-foreground">
                  {current.participant.fantasy_team_name}
                </div>
              )}
            </div>
          ) : (
            <div className="mt-4 max-w-xs text-center text-xs text-muted-foreground">
              {done === total && total > 0
                ? "All athletes are through — head to the draft board."
                : "Waiting for the next athlete to be sent from the timing console."}
            </div>
          )}
        </div>

        {/* Primary CTAs */}
        <div className="mx-auto flex max-w-sm flex-col gap-3">
          <Link to="/order" className="neon-btn">
            View Running Order
          </Link>
          <Link to="/leaderboard" className="neon-btn">
            Leaderboard
          </Link>
        </div>

        {/* Telemetry strip */}
        <div className="grid gap-3 pt-2 md:grid-cols-2">
          <Card className="border-primary/15 bg-card/70 backdrop-blur">
            <CardContent className="p-4">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="font-display text-xs font-black uppercase tracking-[0.32em] text-primary/80">
                  Up Next
                </h2>
                <Radio className="h-3.5 w-3.5 text-primary/60" strokeWidth={1.75} />
              </div>
              {next ? (
                <div className="flex items-center gap-3">
                  <ParticipantAvatar
                    name={next.participant?.name ?? "?"}
                    photoUrl={photos.data?.[next.id] ?? next.participant?.profile_image_url ?? null}
                    size={44}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-display text-lg font-bold uppercase leading-tight">
                      {next.participant?.name}
                    </div>
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                      Order #{next.running_order}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No one queued.</p>
              )}
            </CardContent>
          </Card>

          <Card className="border-primary/15 bg-card/70 backdrop-blur">
            <CardContent className="p-4">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="font-display text-xs font-black uppercase tracking-[0.32em] text-primary/80">
                  Top 5
                </h2>
                <Trophy className="h-3.5 w-3.5 text-primary/60" strokeWidth={1.75} />
              </div>
              {leaderboard.length === 0 ? (
                <p className="text-xs text-muted-foreground">No official times yet.</p>
              ) : (
                <ol className="space-y-1.5">
                  {leaderboard.map((row, i) => (
                    <li
                      key={row.run.id}
                      className="flex items-center gap-2 rounded-md border border-primary/5 bg-[oklch(0.16_0.02_240)] px-2 py-1.5"
                    >
                      <span
                        className={
                          "grid h-6 w-6 place-items-center rounded-full text-[10px] font-black tabular " +
                          (i === 0
                            ? "bg-primary text-primary-foreground shadow-[0_0_10px_var(--color-primary)]"
                            : "bg-primary/10 text-primary")
                        }
                      >
                        {i + 1}
                      </span>
                      <span className="flex-1 truncate text-sm font-semibold uppercase tracking-wide">
                        {row.participant?.name ?? "—"}
                      </span>
                      <span className="timer-digits tabular text-primary text-base">
                        {formatTime(row.run.official_time_ms)}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      <FinishCelebration
        name={celebration?.name ?? null}
        timeMs={celebration?.timeMs ?? null}
        deltaMs={celebration?.deltaMs ?? null}
        onDone={() => setCelebration(null)}
      />
    </div>
  );
}

function Heartbeat() {
  return (
    <svg
      width="26"
      height="14"
      viewBox="0 0 26 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-primary"
      aria-hidden
    >
      <path d="M0 7 H5 L7 3 L10 11 L13 5 L16 9 L18 7 H26" />
    </svg>
  );
}
