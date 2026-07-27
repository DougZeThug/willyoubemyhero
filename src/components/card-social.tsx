import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { MessageSquare, Send, Trash2 } from "lucide-react";
import { deleteComment, postComment, toggleReaction } from "@/lib/social.functions";
import { useMemberSession } from "@/lib/member-token";
import type { CommentRow, ReactionRow } from "@/hooks/use-event-social";
import { cn } from "@/lib/utils";

const REACTIONS = ["🔥", "💀", "😂", "🐐", "🤡", "🍺"] as const;

/** Prompt shown wherever a visitor needs to be a claimed member to interact. */
function ClaimPrompt({ verb }: { verb: string }) {
  return (
    <p className="text-[11px] text-muted-foreground">
      <Link to="/claim" className="text-primary underline">
        Claim your player
      </Link>{" "}
      to {verb}.
    </p>
  );
}

export function CardSocial({
  eventId,
  eventParticipantId,
  reactions,
  comments,
  nameOf,
}: {
  eventId: string;
  eventParticipantId: string;
  reactions: ReactionRow[];
  comments: CommentRow[];
  /** Resolve a participant id to a display name. */
  nameOf: (participantId: string) => string;
}) {
  const me = useMemberSession();
  const qc = useQueryClient();
  const toggleFn = useServerFn(toggleReaction);
  const postFn = useServerFn(postComment);
  const deleteFn = useServerFn(deleteComment);

  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  const mine = useMemo(() => {
    const set = new Set<string>();
    if (!me) return set;
    for (const r of reactions) if (r.participant_id === me.participantId) set.add(r.emoji);
    return set;
  }, [reactions, me]);

  const counts = useMemo(() => {
    const map = new Map<string, ReactionRow[]>();
    for (const r of reactions) {
      const list = map.get(r.emoji) ?? [];
      list.push(r);
      map.set(r.emoji, list);
    }
    return map;
  }, [reactions]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["event-social", eventId] });

  async function onReact(emoji: string) {
    if (!me) return;
    setPending(emoji);
    try {
      await toggleFn({ data: { eventParticipantId, emoji } });
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not react");
    } finally {
      setPending(null);
    }
  }

  async function onPost(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || !me || busy) return;
    setBusy(true);
    try {
      await postFn({ data: { eventParticipantId, body } });
      setDraft("");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not post");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(commentId: string) {
    try {
      await deleteFn({ data: { commentId } });
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete");
    }
  }

  return (
    <div className="mt-8 space-y-6">
      <section>
        <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.3em] text-muted-foreground">
          Reactions
        </div>
        <div className="flex flex-wrap gap-1.5">
          {REACTIONS.map((emoji) => {
            const list = counts.get(emoji) ?? [];
            const active = mine.has(emoji);
            return (
              <button
                key={emoji}
                onClick={() => onReact(emoji)}
                disabled={!me || pending === emoji}
                title={
                  list.length
                    ? list.map((r) => nameOf(r.participant_id)).join(", ")
                    : me
                      ? "Be the first"
                      : "Claim your player to react"
                }
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors disabled:opacity-50",
                  active
                    ? "border-primary bg-primary/15"
                    : "border-white/10 bg-white/[0.02] hover:border-primary/40",
                  !me && "cursor-not-allowed",
                )}
              >
                <span aria-hidden>{emoji}</span>
                <span
                  className={cn(
                    "text-[11px] font-bold tabular",
                    active ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  {list.length}
                </span>
              </button>
            );
          })}
        </div>
        {!me && <div className="mt-2">{<ClaimPrompt verb="react" />}</div>}
      </section>

      <section>
        <div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.3em] text-muted-foreground">
          <MessageSquare className="h-3.5 w-3.5" />
          Trash Talk
          {comments.length > 0 && <span className="text-primary">{comments.length}</span>}
        </div>

        {comments.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nothing yet. Someone start something.</p>
        ) : (
          <ul className="space-y-1.5">
            {comments.map((c) => {
              const canDelete = me?.participantId === c.participant_id;
              return (
                <li
                  key={c.id}
                  className="group flex items-start gap-2 rounded-md border border-white/5 bg-white/[0.02] px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-primary/80">
                      {nameOf(c.participant_id)}
                    </div>
                    <p className="break-words text-sm text-foreground/90">{c.body}</p>
                  </div>
                  {canDelete && (
                    <button
                      onClick={() => onDelete(c.id)}
                      aria-label="Delete your comment"
                      className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {me ? (
          <form onSubmit={onPost} className="mt-3 flex items-center gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, 280))}
              placeholder={`Talk your talk, ${me.name ?? "champ"}…`}
              className="min-w-0 flex-1 rounded-md border border-white/10 bg-white/[0.02] px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus:border-primary/50"
            />
            <button
              type="submit"
              disabled={busy || !draft.trim()}
              aria-label="Post"
              className="shrink-0 rounded-md border border-primary/40 bg-primary/10 p-2 text-primary transition-colors hover:bg-primary/20 disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        ) : (
          <div className="mt-3">
            <ClaimPrompt verb="join in" />
          </div>
        )}
      </section>
    </div>
  );
}
