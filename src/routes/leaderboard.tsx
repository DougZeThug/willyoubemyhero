import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useEventBundle } from "@/hooks/use-event-bundle";
import { ParticipantAvatar } from "@/components/participant-avatar";
import { Card, CardContent } from "@/components/ui/card";
import { formatTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Trophy } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/leaderboard")({
  head: () => ({
    meta: [
      { title: "Leaderboard — Will YOU Be My Hero? Draft Combine" },
      { name: "description", content: "Ranked results from the Will YOU Be My Hero? fantasy draft combine." },
      { property: "og:title", content: "Will YOU Be My Hero? Draft Combine — Leaderboard" },
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
    <div className="circuit-bg min-h-[calc(100dvh-8rem)]">
      <div className="mx-auto max-w-4xl px-4 py-6">
        <PageHeader
          eyebrow="Standings"
          title="Leaderboard"
          icon={<Trophy className="h-5 w-5" />}
          right={
            rows.length > 0 ? (
              <span className="timer-digits tabular text-primary text-lg">
                {rows.length} <span className="text-muted-foreground text-xs font-bold uppercase tracking-widest">finished</span>
              </span>
            ) : null
          }
        />
      <Card className="hud-bezel border-white/10">
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No official times yet — check back after the first athlete crosses.
            </div>
          ) : (
            <ul className="divide-y divide-white/5">
              {rows.map((row, i) => (
                <li
                  key={row.run.id}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 transition",
                    i === 0 && "bg-primary/[0.06] shadow-[inset_3px_0_0_0_var(--color-primary)]",
                  )}
                >
                  <span
                    className={
                      "grid h-9 w-9 shrink-0 place-items-center rounded-full font-display font-black tabular " +
                      (i === 0
                        ? "hud-bezel text-primary ring-1 ring-primary/60"
                        : i < 3
                          ? "hud-bezel text-primary/90"
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
                    <Badge variant="outline" className="hidden border-primary/40 text-primary sm:inline-flex">
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
    </div>
  );
}

function PageHeader({
  eyebrow,
  title,
  icon,
  right,
}: {
  eyebrow: string;
  title: string;
  icon?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-5 border-b border-primary/20 pb-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-primary">
            {icon}
            <span className="font-display text-xs font-bold uppercase tracking-[0.3em]">
              {eyebrow}
            </span>
          </div>
          <h1 className="font-display text-3xl font-black uppercase leading-none mt-1">
            {title}
          </h1>
        </div>
        {right}
      </div>
    </div>
  );
}