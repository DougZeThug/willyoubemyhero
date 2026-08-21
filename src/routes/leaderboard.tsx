import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useEventBundle } from "@/hooks/use-event-bundle";
import { useEventPhotoUrls, useEventCardUrls } from "@/hooks/use-photo-urls";
import { ParticipantAvatar } from "@/components/participant-avatar";
import { Card, CardContent } from "@/components/ui/card";
import { formatTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Trophy, Share2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { FeedDegradedBanner, FeedError, FeedLoading } from "@/components/feed-state";
import { Button } from "@/components/ui/button";
import { ResultCard } from "@/components/result-card";
import { exportCardPng } from "@/lib/share-card";

export const Route = createFileRoute("/leaderboard")({
  head: () => ({
    meta: [
      { title: "Leaderboard — Will YOU Be My Hero? Draft Combine" },
      {
        name: "description",
        content: "Ranked results from the Will YOU Be My Hero? fantasy draft combine.",
      },
      { property: "og:title", content: "Will YOU Be My Hero? Draft Combine — Leaderboard" },
      { property: "og:description", content: "Official combine times, penalties, and splits." },
    ],
  }),
  component: LeaderboardPage,
});

function LeaderboardPage() {
  const { event, bundle, loading, error, failedTables, realtimeDegraded, refetch } =
    useEventBundle();
  const photos = useEventPhotoUrls(event?.id ?? null);
  const cards = useEventCardUrls(event?.id ?? null);
  const [sharingRunId, setSharingRunId] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
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

  const shareRow = rows.find((r) => r.run.id === sharingRunId);
  const shareData = shareRow
    ? {
        eventName: event?.name ?? "Draft Combine",
        eventYear: event?.year ?? null,
        participantName: shareRow.ep?.participant?.name ?? "Athlete",
        fantasyTeam: shareRow.ep?.participant?.fantasy_team_name ?? null,
        photoUrl:
          photos.data?.[shareRow.ep?.id ?? ""] ??
          shareRow.ep?.participant?.profile_image_url ??
          null,
        totalMs: shareRow.run.official_time_ms ?? 0,
        penaltyMs: shareRow.run.penalty_ms ?? 0,
        rank: rows.findIndex((r) => r.run.id === sharingRunId) + 1,
        splits: (bundle?.splits ?? [])
          .filter((s) => s.run_id === shareRow.run.id)
          .map((s) => ({
            label: bundle?.stations.find((st) => st.id === s.station_id)?.name ?? "Split",
            ms: s.segment_time_ms ?? 0,
          })),
      }
    : null;

  async function handleShare(runId: string) {
    setSharingRunId(runId);
    // wait a tick for offscreen render
    await new Promise((r) => setTimeout(r, 100));
    try {
      if (cardRef.current) {
        const filename = `combine-${runId.slice(0, 8)}.png`;
        await exportCardPng(cardRef.current, filename);
      }
    } finally {
      setSharingRunId(null);
    }
  }

  if (loading && !bundle) {
    return (
      <div className="circuit-bg min-h-[calc(100dvh-8rem)]">
        <div className="mx-auto max-w-4xl px-4 py-10">
          <FeedLoading label="Reading the standings…" />
        </div>
      </div>
    );
  }

  if (error && !bundle) {
    return (
      <div className="circuit-bg min-h-[calc(100dvh-8rem)]">
        <div className="mx-auto max-w-4xl px-4 py-10">
          <FeedError message={error.message} onRetry={() => void refetch()} />
        </div>
      </div>
    );
  }

  return (
    <div className="circuit-bg min-h-[calc(100dvh-8rem)]">
      <div className="mx-auto max-w-4xl px-4 py-6">
        {realtimeDegraded && <FeedDegradedBanner className="mb-4" />}
        <PageHeader
          eyebrow="Standings"
          title="Leaderboard"
          icon={<Trophy className="h-5 w-5" />}
          right={
            rows.length > 0 ? (
              <span className="timer-digits tabular text-primary text-lg">
                {rows.length}{" "}
                <span className="text-muted-foreground text-xs font-bold uppercase tracking-widest">
                  finished
                </span>
              </span>
            ) : null
          }
        />
        <Card className="hud-bezel border-white/10">
          <CardContent className="p-0">
            {rows.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                {failedTables.length > 0
                  ? "Couldn't read the results just now — retrying."
                  : "No official times yet — check back after the first athlete crosses."}
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
                      cardUrl={row.ep ? (cards.data?.[row.ep.id]?.front ?? null) : null}
                      photoUrl={
                        photos.data?.[row.ep?.id ?? ""] ??
                        row.ep?.participant?.profile_image_url ??
                        null
                      }
                      size={40}
                    />
                    <div className="min-w-0 flex-1">
                      {row.ep ? (
                        <Link
                          to="/players/$id"
                          params={{ id: row.ep.id }}
                          className="block truncate font-display text-lg font-bold uppercase leading-tight hover:text-primary"
                        >
                          {row.ep.participant?.name ?? "—"}
                        </Link>
                      ) : (
                        <div className="truncate font-display text-lg font-bold uppercase leading-tight">
                          —
                        </div>
                      )}
                      <div className="truncate text-xs text-muted-foreground">
                        {row.ep?.participant?.fantasy_team_name ??
                          row.ep?.participant?.nickname ??
                          "—"}
                        {row.run.penalty_ms > 0 && (
                          <>
                            {" · "}
                            <span className="text-warn">
                              +{formatTime(row.run.penalty_ms)} pen.
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    {row.ep?.selected_draft_position != null && (
                      <Badge
                        variant="outline"
                        className="hidden border-primary/40 text-primary sm:inline-flex"
                      >
                        Pick #{row.ep.selected_draft_position}
                      </Badge>
                    )}
                    <div className="timer-digits tabular text-2xl text-primary">
                      {formatTime(row.run.official_time_ms)}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 text-primary/70 hover:text-primary"
                      aria-label="Share result card"
                      onClick={() => handleShare(row.run.id)}
                      disabled={sharingRunId === row.run.id}
                    >
                      <Share2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
      {/* Offscreen card for PNG export */}
      {shareData && (
        <div style={{ position: "fixed", top: -10000, left: -10000, pointerEvents: "none" }}>
          <ResultCard ref={cardRef} data={shareData} />
        </div>
      )}
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
          <h1 className="font-display text-3xl font-black uppercase leading-none mt-1">{title}</h1>
        </div>
        {right}
      </div>
    </div>
  );
}
