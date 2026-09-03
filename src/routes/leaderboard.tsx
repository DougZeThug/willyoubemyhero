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
import { exportCardPng, waitForPaint } from "@/lib/share-card";
import { toast } from "sonner";
import { standings } from "@/lib/standings";

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
  // The same standings the tier rules use, not a second looser set. Ranking
  // official *runs* put a re-timed athlete on the board twice, kept a scratched
  // one's place, and numbered a dead heat 1 and 2 beside two champion cards —
  // the board contradicting the card on the same screen.
  const rows = useMemo(() => {
    const parts = bundle?.participants ?? [];
    return standings(bundle).map((s) => ({
      run: s.run,
      place: s.place,
      ep: parts.find((p) => p.participant_id === s.participantId),
    }));
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
        rank: shareRow.place,
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
    try {
      // The offscreen card mounts on the render this state change causes, so
      // one frame is what it takes for the ref to be filled. The fixed 100ms
      // this replaces was also a complete no-op when it was not: no catch,
      // no node, no card, no message.
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const node = cardRef.current;
      if (!node) throw new Error("Share card not ready");
      await waitForPaint(node);
      await exportCardPng(node, `combine-${runId.slice(0, 8)}.png`);
    } catch (e) {
      // It used to be try/finally with no catch at all: an unhandled
      // rejection, and a screen reader user got nothing whatsoever.
      toast.error(e instanceof Error ? e.message : "Could not export that card");
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
        {(realtimeDegraded || !!error) && <FeedDegradedBanner className="mb-4" />}
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
              // An ordered list, because it is one. The place is rendered
              // separately for the look, so the marker is suppressed.
              <ol className="list-none divide-y divide-white/5">
                {rows.map((row) => (
                  <li
                    key={row.run.id}
                    className={cn(
                      "flex items-center gap-3 px-4 py-3 transition",
                      row.place === 1 &&
                        "bg-primary/[0.06] shadow-[inset_3px_0_0_0_var(--color-primary)]",
                    )}
                  >
                    <span
                      className={
                        "grid h-9 w-9 shrink-0 place-items-center rounded-full font-display font-black tabular " +
                        (row.place === 1
                          ? "hud-bezel text-primary ring-1 ring-primary/60"
                          : row.place <= 3
                            ? "hud-bezel text-primary/90"
                            : "bg-white/10 text-foreground")
                      }
                    >
                      {row.place}
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
                      className="h-11 w-11 text-primary/70 hover:text-primary"
                      // Thirteen buttons carrying the identical label read as
                      // thirteen identical controls out of context.
                      aria-label={`Share ${row.ep?.participant?.name ?? "this"} result card`}
                      onClick={() => handleShare(row.run.id)}
                      disabled={sharingRunId === row.run.id}
                    >
                      <Share2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
      {/* Offscreen card for PNG export. aria-hidden: it is a rendering of a
          row that is already on the page. */}
      {shareData && (
        <div
          aria-hidden
          style={{ position: "fixed", top: -10000, left: -10000, pointerEvents: "none" }}
        >
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
