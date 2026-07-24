import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useEventBundle } from "@/hooks/use-event-bundle";
import { ParticipantAvatar } from "@/components/participant-avatar";
import { Card, CardContent } from "@/components/ui/card";
import { formatTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Trophy } from "lucide-react";

export const Route = createFileRoute("/leaderboard")({
  head: () => ({
    meta: [
      { title: "Leaderboard — WWBH Draft Combine" },
      { name: "description", content: "Ranked results from the We Will Be Heroes fantasy draft combine." },
      { property: "og:title", content: "WWBH Draft Combine — Leaderboard" },
      { property: "og:description", content: "Official combine times, penalties, and splits." },
    ],
  }),
  component: LeaderboardPage,
});

function LeaderboardPage() {
  const { bundle } = useEventBundle();
  const rows = useMemo(() => {
    const parts = bundle?.participants ?? [];
    const runs = bundle?.runs ?? [];
    return runs
      .filter((r) => r.is_official)
      .map((r) => {
        const ep = parts.find((p) => p.participant_id === r.participant_id);
        return { run: r, ep };
      })
      .sort((a, b) => (a.run.official_time_ms ?? Infinity) - (b.run.official_time_ms ?? Infinity));
  }, [bundle]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className="mb-5 flex items-center gap-3">
        <Trophy className="h-6 w-6 text-primary" />
        <h1 className="font-display text-3xl font-black uppercase">Leaderboard</h1>
      </div>
      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No official times yet — check back after the first athlete crosses.
            </div>
          ) : (
            <ul className="divide-y divide-white/5">
              {rows.map((row, i) => (
                <li key={row.run.id} className="flex items-center gap-3 px-4 py-3">
                  <span
                    className={
                      "grid h-9 w-9 shrink-0 place-items-center rounded-full font-display font-black " +
                      (i === 0
                        ? "bg-primary text-primary-foreground"
                        : i < 3
                          ? "bg-primary/25 text-primary"
                          : "bg-white/10 text-foreground")
                    }
                  >
                    {i + 1}
                  </span>
                  <ParticipantAvatar
                    name={row.ep?.participant?.name ?? "?"}
                    photoUrl={row.ep?.participant?.profile_image_url ?? null}
                    size={40}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-display text-lg font-bold uppercase leading-tight">
                      {row.ep?.participant?.name ?? "—"}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {row.ep?.participant?.fantasy_team_name ?? row.ep?.participant?.nickname ?? "—"}
                      {row.run.penalty_ms > 0 && (
                        <>
                          {" · "}
                          <span className="text-warn">+{formatTime(row.run.penalty_ms)} pen.</span>
                        </>
                      )}
                    </div>
                  </div>
                  {row.ep?.selected_draft_position != null && (
                    <Badge variant="outline" className="hidden sm:inline-flex">
                      Pick #{row.ep.selected_draft_position}
                    </Badge>
                  )}
                  <div className="timer-digits tabular text-2xl text-primary">
                    {formatTime(row.run.official_time_ms)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}