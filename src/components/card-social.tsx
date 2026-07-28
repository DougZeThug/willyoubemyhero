import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { MessageSquare, Send, Trash2 } from "lucide-react";
import { deleteComment, postComment, toggleReaction } from "@/lib/social.functions";
import { useMemberSession } from "@/lib/member-token";
import type { CommentRow, ReactionRow } from "@/hooks/use-event-social";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const REACTIONS = ["🔥", "💀", "😂", "🐐", "🤡", "🍺"] as const;

/** Particles thrown off a reaction button when you add one. */
const BURST = [
  { x: -26, y: -34 },
  { x: 0, y: -44 },
  { x: 26, y: -34 },
  { x: -16, y: -20 },
  { x: 16, y: -20 },
];

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
  // Which emoji is mid-burst. Cleared by the animation's own onComplete.
  const [bursting, setBursting] = useState<string | null>(null);
  /**
   * Reactions this device has toggled but whose refetch hasn't landed yet.
   *
   * The server round trip is followed by a full `invalidateQueries` refetch, so
   * without this the count sat still for a beat after every tap and the button
   * read as broken. Maps emoji to the signed delta this device is responsible
   * for, and is dropped as soon as the authoritative list agrees.
   */
  const [optimistic, setOptimistic] = useState<Record<string, number>>({});

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
    const adding = !mine.has(emoji);
    setPending(emoji);
    setOptimistic((prev) => ({ ...prev, [emoji]: (prev[emoji] ?? 0) + (adding ? 1 : -1) }));
    // motion/react animates regardless of the OS setting unless something opts
    // out for it, so the burst and its haptic are both gated here.
    if (adding && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setBursting(emoji);
      // Same tick the flip haptic uses, so every card interaction feels related.
      navigator.vibrate?.([8]);
    }
    try {
      await toggleFn({ data: { eventParticipantId, emoji } });
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not react");
    } finally {
      // Whether the write succeeded or failed, the refetched list is now the
      // truth — a failed toggle rolls back by simply being forgotten here.
      setOptimistic((prev) => {
        const next = { ...prev };
        delete next[emoji];
        return next;
      });
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
            const count = Math.max(0, list.length + (optimistic[emoji] ?? 0));
            const names = list.map((r) => nameOf(r.participant_id));
            return (
              <div key={emoji} className="relative">
                <button
                  onClick={() => onReact(emoji)}
                  disabled={!me || pending === emoji}
                  aria-label={me ? `React with ${emoji}` : "Claim your player to react"}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-transform duration-150 active:scale-90 disabled:opacity-50",
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
                    {count}
                  </span>
                </button>

                {/* Particles fly out of the button itself. pointer-events-none so
                    they never eat the next tap in a rapid double-react. */}
                <AnimatePresence>
                  {bursting === emoji && (
                    <div
                      aria-hidden
                      className="pointer-events-none absolute inset-0 flex items-center justify-center"
                    >
                      {BURST.map((p, i) => (
                        <motion.span
                          key={i}
                          className="absolute text-sm"
                          initial={{ opacity: 1, x: 0, y: 0, scale: 0.6 }}
                          animate={{ opacity: 0, x: p.x, y: p.y, scale: 1.25 }}
                          transition={{ duration: 0.55, ease: "easeOut", delay: i * 0.02 }}
                          onAnimationComplete={
                            i === BURST.length - 1 ? () => setBursting(null) : undefined
                          }
                        >
                          {emoji}
                        </motion.span>
                      ))}
                    </div>
                  )}
                </AnimatePresence>

                {/* Who reacted. This was a `title` attribute, which touch devices
                    never show — and touch is most of this audience. */}
                {names.length > 0 && (
                  <Popover>
                    <PopoverTrigger
                      className="absolute -right-1 -top-1 h-4 w-4 rounded-full text-[9px] text-muted-foreground hover:text-primary"
                      aria-label={`Who reacted with ${emoji}`}
                    >
                      ⓘ
                    </PopoverTrigger>
                    <PopoverContent className="w-auto max-w-[14rem] px-3 py-2">
                      <p className="text-xs leading-snug text-foreground/90">{names.join(", ")}</p>
                    </PopoverContent>
                  </Popover>
                )}
              </div>
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
