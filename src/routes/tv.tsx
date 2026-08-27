import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useEventBundle } from "@/hooks/use-event-bundle";
import { useEventPhotoUrls, useEventCardUrls } from "@/hooks/use-photo-urls";
import { ParticipantAvatar } from "@/components/participant-avatar";
import { formatTime } from "@/lib/format";
import { compareOfficialTime } from "@/lib/standings";
import { currentAthlete } from "@/lib/current-athlete";

export const Route = createFileRoute("/tv")({
  head: () => ({
    meta: [
      { title: "TV Broadcast — Draft Combine" },
      { name: "description", content: "Big-screen broadcast leaderboard for the draft combine." },
      { property: "og:title", content: "Draft Combine — TV Broadcast" },
      { property: "og:description", content: "Full-screen leaderboard for spectators." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: TvPage,
});

function TvPage() {
  const { event, bundle, loading, error, failedTables, realtimeDegraded, refetch } =
    useEventBundle();
  const photos = useEventPhotoUrls(event?.id ?? null);
  const cards = useEventCardUrls(event?.id ?? null);

  const rows = useMemo(() => {
    const parts = bundle?.participants ?? [];
    const runs = bundle?.runs ?? [];
    return runs
      .filter((r) => r.is_official)
      .map((r) => ({ run: r, ep: parts.find((p) => p.participant_id === r.participant_id) }))
      .sort((a, b) => compareOfficialTime(a.run, b.run));
  }, [bundle]);

  const { athlete: current, onClock } = currentAthlete(bundle?.participants ?? []);

  if ((loading || error) && !bundle) {
    return (
      <div className="circuit-bg -mx-4 -mb-8 -mt-4 grid min-h-screen place-items-center px-8 py-8 sm:-mx-6 sm:px-10">
        <div className="text-center">
          <div className="font-display text-4xl font-black uppercase tracking-[0.2em] text-muted-foreground">
            {error ? "Can't reach the combine" : "Reading the combine…"}
          </div>
          {error && (
            <button
              onClick={() => void refetch()}
              className="mt-6 rounded-md border border-warn/40 bg-warn/10 px-6 py-3 font-display text-xl font-black uppercase tracking-widest text-warn"
            >
              Try again
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="circuit-bg -mx-4 -mb-8 -mt-4 min-h-screen px-8 py-8 sm:-mx-6 sm:px-10">
      {(realtimeDegraded || !!error) && (
        <div className="mb-4 rounded-md border border-warn/30 bg-warn/10 px-4 py-2 text-center font-display text-lg font-black uppercase tracking-[0.2em] text-warn">
          Live feed down — refreshing every few seconds
        </div>
      )}
      <header className="mb-6 flex items-end justify-between">
        <div>
          <div className="font-display text-xs font-black uppercase tracking-[0.5em] text-primary">
            Will YOU Be My Hero?
          </div>
          <div className="font-display text-5xl font-black uppercase leading-none">
            Draft Combine {event?.year ?? ""}
          </div>
        </div>
        {current && (
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-[0.4em] text-muted-foreground">
              {onClock ? "On the Clock" : "Up Next"}
            </div>
            <div className="font-display text-3xl font-black uppercase text-primary">
              {current.participant?.name}
            </div>
          </div>
        )}
      </header>

      <div className="grid grid-cols-2 gap-4">
        {rows.slice(0, 16).map((row, i) => (
          <div
            key={row.run.id}
            className={
              "flex items-center gap-4 rounded-2xl border p-4 " +
              (i === 0
                ? "hud-bezel border-primary/60 hud-glow"
                : "border-primary/15 bg-[oklch(0.16_0.02_240)]")
            }
          >
            <span
              className={
                "grid h-14 w-14 place-items-center rounded-full font-display text-2xl font-black " +
                (i < 3 ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary")
              }
            >
              {i + 1}
            </span>
            <ParticipantAvatar
              name={row.ep?.participant?.name ?? "?"}
              cardUrl={row.ep ? (cards.data?.[row.ep.id]?.front ?? null) : null}
              photoUrl={
                photos.data?.[row.ep?.id ?? ""] ?? row.ep?.participant?.profile_image_url ?? null
              }
              size={56}
            />
            <div className="min-w-0 flex-1">
              {row.ep ? (
                <Link
                  to="/players/$id"
                  params={{ id: row.ep.id }}
                  className="block truncate font-display text-2xl font-black uppercase leading-tight hover:text-primary"
                >
                  {row.ep.participant?.name}
                </Link>
              ) : (
                <div className="truncate font-display text-2xl font-black uppercase leading-tight">
                  —
                </div>
              )}
              {row.ep?.participant?.fantasy_team_name && (
                <div className="truncate text-xs uppercase tracking-widest text-muted-foreground">
                  {row.ep.participant.fantasy_team_name}
                </div>
              )}
            </div>
            <div
              className="timer-digits text-4xl text-primary"
              style={{ textShadow: "0 0 12px var(--color-primary)" }}
            >
              {formatTime(row.run.official_time_ms)}
            </div>
          </div>
        ))}
        {rows.length === 0 && (
          <div className="col-span-2 rounded-2xl border border-primary/20 bg-[oklch(0.16_0.02_240)] p-10 text-center text-muted-foreground">
            {failedTables.length > 0
              ? "Couldn't read the results just now — retrying."
              : "No official times yet."}
          </div>
        )}
      </div>
    </div>
  );
}
