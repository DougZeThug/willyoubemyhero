import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Award, Lock, Vote } from "lucide-react";
import { useEventBundle } from "@/hooks/use-event-bundle";
import { useEventPhotoUrls, useEventCardUrls } from "@/hooks/use-photo-urls";
import { useEventAwards } from "@/hooks/use-event-social";
import { useMemberSession } from "@/lib/member-token";
import { castAwardVote, getMyAwardVotes } from "@/lib/social.functions";
import { AWARD_CATEGORIES } from "@/lib/awards";
import { ParticipantAvatar } from "@/components/participant-avatar";
import { cn } from "@/lib/utils";
import { FeedDegradedBanner, FeedError, FeedLoading } from "@/components/feed-state";

export const Route = createFileRoute("/awards")({
  head: () => ({
    meta: [
      { title: "League Awards — Will YOU Be My Hero? Draft Combine" },
      {
        name: "description",
        content: "Vote on the league superlatives. One vote per member per category.",
      },
      { property: "og:title", content: "Draft Combine — League Awards" },
      { property: "og:description", content: "Vote on the superlatives that actually matter." },
    ],
  }),
  component: AwardsPage,
});

function AwardsPage() {
  const { event, bundle, loading, error, failedTables, realtimeDegraded, refetch } =
    useEventBundle();
  const photos = useEventPhotoUrls(event?.id ?? null);
  const cards = useEventCardUrls(event?.id ?? null);
  const me = useMemberSession();
  const qc = useQueryClient();
  const awards = useEventAwards(event?.id ?? null);
  const myVotesFn = useServerFn(getMyAwardVotes);
  const voteFn = useServerFn(castAwardVote);
  const [pending, setPending] = useState<string | null>(null);

  const locked = !!event?.awards_locked;

  const myVotes = useQuery({
    queryKey: ["my-award-votes", event?.id, me?.participantId],
    queryFn: () => myVotesFn({ data: { eventId: event!.id } }),
    enabled: !!event?.id && !!me,
    staleTime: 30_000,
  });

  const voteByCategory = useMemo(() => {
    const map = new Map<string, string>();
    for (const v of myVotes.data ?? []) map.set(v.category, v.target_participant_id);
    return map;
  }, [myVotes.data]);

  const roster = useMemo(
    () =>
      [...(bundle?.participants ?? [])].sort((a, b) =>
        (a.participant?.name ?? "").localeCompare(b.participant?.name ?? ""),
      ),
    [bundle],
  );

  const winnersByCategory = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const a of awards.data ?? []) {
      if (!a.award_type || !a.participant_id) continue;
      const list = map.get(a.award_type) ?? [];
      list.push(a.participant_id);
      map.set(a.award_type, list);
    }
    return map;
  }, [awards.data]);

  async function vote(category: string, targetParticipantId: string) {
    if (!event?.id || !me || locked) return;
    setPending(`${category}:${targetParticipantId}`);
    try {
      await voteFn({ data: { eventId: event.id, category, targetParticipantId } });
      await qc.invalidateQueries({ queryKey: ["my-award-votes", event.id, me.participantId] });
      toast.success("Vote recorded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not vote");
    } finally {
      setPending(null);
    }
  }

  const nameOf = (participantId: string) =>
    roster.find((p) => p.participant_id === participantId)?.participant?.name ?? "Someone";

  if (loading && !bundle) {
    return (
      <div className="circuit-bg min-h-[calc(100dvh-8rem)]">
        <div className="mx-auto max-w-3xl px-4 py-10">
          <FeedLoading label="Reading the awards…" />
        </div>
      </div>
    );
  }

  if (error && !bundle) {
    return (
      <div className="circuit-bg min-h-[calc(100dvh-8rem)]">
        <div className="mx-auto max-w-3xl px-4 py-10">
          <FeedError message={error.message} onRetry={() => void refetch()} />
        </div>
      </div>
    );
  }

  return (
    <div className="circuit-bg min-h-[calc(100dvh-8rem)]">
      <div className="mx-auto max-w-3xl px-4 py-6">
        {realtimeDegraded && <FeedDegradedBanner className="mb-4" />}
        <div className="mb-5 border-b border-primary/20 pb-4">
          <div className="flex items-center gap-2 text-primary">
            <Award className="h-5 w-5" />
            <span className="font-display text-xs font-bold uppercase tracking-[0.3em]">
              Superlatives
            </span>
          </div>
          <h1 className="mt-1 font-display text-3xl font-black uppercase leading-none">
            League Awards
          </h1>
          <p className="mt-2 text-xs text-muted-foreground">
            {locked
              ? "Voting is closed. Here's how it landed."
              : "One vote per category. You can change your mind until the commissioner closes voting — nobody sees the tally before then."}
          </p>
        </div>

        {!me && !locked && (
          <div className="mb-5 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
            <Link to="/claim" className="font-bold text-primary underline">
              Claim your player
            </Link>{" "}
            <span className="text-muted-foreground">to vote.</span>
          </div>
        )}

        <div className="space-y-5">
          {AWARD_CATEGORIES.map((cat) => {
            const myVote = voteByCategory.get(cat.id);
            const winners = winnersByCategory.get(cat.id) ?? [];
            return (
              <section key={cat.id} className="hud-bezel rounded-lg border border-white/10 p-4">
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-lg" aria-hidden>
                    {cat.icon}
                  </span>
                  <h2 className="font-display text-lg font-black uppercase leading-none">
                    {cat.label}
                  </h2>
                  {locked && <Lock className="h-3.5 w-3.5 text-muted-foreground" />}
                </div>
                <p className="mb-3 text-xs text-muted-foreground">{cat.blurb}</p>

                {locked ? (
                  winners.length ? (
                    <div className="flex flex-wrap gap-2">
                      {winners.map((pid) => (
                        <Link
                          key={pid}
                          to="/players/$id"
                          params={{
                            id: roster.find((p) => p.participant_id === pid)?.id ?? "",
                          }}
                          className="inline-flex items-center gap-2 rounded-full border border-warn/50 bg-warn/10 px-3 py-1.5 text-sm font-bold uppercase tracking-wide text-warn hover:bg-warn/20"
                        >
                          <span aria-hidden>{cat.icon}</span>
                          {nameOf(pid)}
                        </Link>
                      ))}
                      {winners.length > 1 && (
                        <span className="self-center text-[10px] uppercase tracking-widest text-muted-foreground">
                          tied
                        </span>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {failedTables.length > 0
                        ? "Couldn't read the votes just now — retrying."
                        : "No votes cast."}
                    </p>
                  )
                ) : (
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                    {roster.map((p) => {
                      const pid = p.participant_id;
                      const chosen = myVote === pid;
                      const key = `${cat.id}:${pid}`;
                      return (
                        <button
                          key={p.id}
                          onClick={() => vote(cat.id, pid)}
                          disabled={!me || pending === key}
                          className={cn(
                            "flex items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors disabled:opacity-50",
                            chosen
                              ? "border-primary bg-primary/15"
                              : "border-white/10 bg-white/[0.02] hover:border-primary/40",
                          )}
                        >
                          <ParticipantAvatar
                            name={p.participant?.name ?? "?"}
                            cardUrl={cards.data?.[p.id]?.front ?? null}
                            photoUrl={
                              photos.data?.[p.id] ?? p.participant?.profile_image_url ?? null
                            }
                            size={24}
                          />
                          <span
                            className={cn(
                              "min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-wide",
                              chosen ? "text-primary" : "text-foreground",
                            )}
                          >
                            {p.participant?.name ?? "—"}
                          </span>
                          {chosen && <Vote className="h-3.5 w-3.5 shrink-0 text-primary" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>

        {!locked && me && (
          <p className="mt-5 text-center text-[11px] text-muted-foreground">
            Voted in {voteByCategory.size} of {AWARD_CATEGORIES.length} categories.
          </p>
        )}
      </div>
    </div>
  );
}
