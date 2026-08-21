import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { User2, Trophy, Radio } from "lucide-react";
import { useEventBundle } from "@/hooks/use-event-bundle";
import { useEventPhotoUrls, useEventCardUrls } from "@/hooks/use-photo-urls";
import { ParticipantAvatar } from "@/components/participant-avatar";
import { HudTimer } from "@/components/hud-timer";
import { FinishCelebration } from "@/components/finish-celebration";
import { formatTime } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { useFinishWatcher } from "@/hooks/use-finish-watcher";
import { currentAthlete, fieldSize, idleFieldState } from "@/lib/current-athlete";
import { FeedDegradedBanner, FeedError, FeedLoading } from "@/components/feed-state";
import { onClockElapsedMs, type OnClockEntry } from "@/lib/live-clock";

export const Route = createFileRoute("/live")({
  head: () => ({
    meta: [
      { title: "Live Spectator — Will YOU Be My Hero? Draft Combine" },
      {
        name: "description",
        content:
          "Spectator broadcast view of the draft combine — timer, current athlete, and leaderboard.",
      },
      { property: "og:title", content: "Will YOU Be My Hero? Draft Combine — Live" },
      { property: "og:description", content: "Read-only broadcast feed of the timed combine." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LivePage,
});

function LivePage() {
  const { event, bundle, loading, error, failedTables, realtimeDegraded, refetch } =
    useEventBundle();
  const photos = useEventPhotoUrls(event?.id ?? null);
  const cards = useEventCardUrls(event?.id ?? null);
  const [celebration, setCelebration] = useState<{
    name: string;
    timeMs: number;
    deltaMs: number;
  } | null>(null);

  const { current, onClock, leaderboard, done, total } = useMemo(() => {
    const parts = bundle?.participants ?? [];
    const runs = bundle?.runs ?? [];
    const slot = currentAthlete(parts);
    const finished = runs
      .filter((r) => r.is_official)
      .map((r) => {
        const ep = parts.find((p) => p.participant_id === r.participant_id);
        return { run: r, ep };
      })
      .sort((a, b) => (a.run.official_time_ms ?? 0) - (b.run.official_time_ms ?? 0));
    return {
      current: slot.athlete,
      onClock: slot.onClock,
      leaderboard: finished.slice(0, 5),
      done: finished.length,
      total: fieldSize(parts),
    };
  }, [bundle]);

  useFinishWatcher(bundle, (finish) => setCelebration(finish));

  // Memoised on the stamp rather than recomputed each render: HudTimer restarts
  // its interpolation whenever runningSinceMs changes, so a fresh Date.now()
  // every render would re-anchor the clock on every bundle refetch.
  // Read structurally: on_clock_since is newer than the checked-in generated
  // types (supabase/migrations/20260821120000_on_clock_since.sql), the same way
  // card-rarity.ts declares card_rarity for itself.
  const onClockSince = onClock ? ((current as OnClockEntry | null)?.on_clock_since ?? null) : null;
  const onClockBaseMs = useMemo(
    () => onClockElapsedMs({ on_clock_since: onClockSince }, Date.now()) ?? 0,
    [onClockSince],
  );

  // "Everyone is done" is only true when there was somebody to be done. It used
  // to be what the page said before the first fetch had even returned.
  const emptyReason = {
    "roster-failed": "Couldn't read the roster just now — retrying.",
    "no-roster": "No roster yet. The commissioner sets the field.",
    "all-done": "Every athlete is done. Nice work.",
    waiting: "Nobody on the clock right now.",
  }[idleFieldState(done, total, failedTables.includes("event_participants"))];

  if (loading && !bundle) {
    return (
      <div className="circuit-bg min-h-[calc(100vh-4.5rem)]">
        <div className="mx-auto max-w-6xl px-4 pb-6 pt-10">
          <FeedLoading />
        </div>
      </div>
    );
  }

  if (error && !bundle) {
    return (
      <div className="circuit-bg min-h-[calc(100vh-4.5rem)]">
        <div className="mx-auto max-w-6xl px-4 pb-6 pt-10">
          <FeedError message={error.message} onRetry={() => void refetch()} />
        </div>
      </div>
    );
  }

  return (
    <div className="circuit-bg min-h-[calc(100vh-4.5rem)]">
      <div className="mx-auto max-w-6xl space-y-6 px-4 pb-6 pt-4 sm:pt-6">
        <div className="flex items-center justify-center gap-2 text-primary">
          <Radio className="h-4 w-4 animate-pulse" />
          <span className="font-display text-[10px] font-black uppercase tracking-[0.4em]">
            Live · Spectator
          </span>
        </div>

        {(realtimeDegraded || !!error) && <FeedDegradedBanner />}

        <div className="flex flex-col items-center">
          <HudTimer
            runningSinceMs={onClockBaseMs}
            paused={!onClock}
            status={
              onClock ? "On the Clock" : current ? "Up Next" : loading ? "Loading" : "Standby"
            }
            size={340}
          >
            {current ? (
              <ParticipantAvatar
                name={current.participant?.name ?? "?"}
                cardUrl={cards.data?.[current.id]?.front ?? null}
                photoUrl={
                  photos.data?.[current.id] ?? current.participant?.profile_image_url ?? null
                }
                size={220}
                className="opacity-80"
              />
            ) : (
              <User2 className="h-40 w-40 text-primary/60" strokeWidth={1.25} />
            )}
          </HudTimer>
          {onClock && onClockSince && (
            <div className="mt-1 text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
              Unofficial
            </div>
          )}
          {current ? (
            <div className="mt-4 text-center">
              <Link
                to="/players/$id"
                params={{ id: current.id }}
                className="font-display text-3xl font-black uppercase tracking-wide hover:text-primary"
              >
                {current.participant?.name}
              </Link>
              {current.participant?.fantasy_team_name && (
                <div className="text-xs text-muted-foreground">
                  {current.participant.fantasy_team_name}
                </div>
              )}
            </div>
          ) : (
            <div className="mt-4 text-center text-xs text-muted-foreground">{emptyReason}</div>
          )}
        </div>

        <Card className="hud-bezel border-primary/20">
          <CardContent className="p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-display text-xs font-black uppercase tracking-[0.32em] text-primary/80">
                Top 5
              </h2>
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                {done}/{total} done
              </span>
              <Trophy className="h-3.5 w-3.5 text-primary/60" />
            </div>
            {leaderboard.length === 0 ? (
              <p className="text-xs text-muted-foreground">No official times yet.</p>
            ) : (
              <ol className="space-y-1.5">
                {leaderboard.map((row, i) => (
                  <li
                    key={row.run.id}
                    className="flex items-center gap-2 rounded-md border border-primary/5 bg-[oklch(0.16_0.02_240)] px-2 py-2"
                  >
                    <span
                      className={
                        "grid h-7 w-7 place-items-center rounded-full text-[11px] font-black " +
                        (i === 0
                          ? "bg-primary text-primary-foreground shadow-[0_0_10px_var(--color-primary)]"
                          : "bg-primary/10 text-primary")
                      }
                    >
                      {i + 1}
                    </span>
                    <ParticipantAvatar
                      name={row.ep?.participant?.name ?? "?"}
                      cardUrl={row.ep ? (cards.data?.[row.ep.id]?.front ?? null) : null}
                      photoUrl={
                        photos.data?.[row.ep?.id ?? ""] ??
                        row.ep?.participant?.profile_image_url ??
                        null
                      }
                      size={32}
                    />
                    {row.ep ? (
                      <Link
                        to="/players/$id"
                        params={{ id: row.ep.id }}
                        className="flex-1 truncate text-sm font-semibold uppercase tracking-wide hover:text-primary"
                      >
                        {row.ep.participant?.name ?? "—"}
                      </Link>
                    ) : (
                      <span className="flex-1 truncate text-sm font-semibold uppercase tracking-wide">
                        —
                      </span>
                    )}
                    <span className="timer-digits tabular text-primary text-lg">
                      {formatTime(row.run.official_time_ms)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
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
