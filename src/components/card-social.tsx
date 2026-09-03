import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { MessageSquare, Send, Trash2 } from "lucide-react";
import { deleteComment, postComment, toggleReaction } from "@/lib/social.functions";
import { useMemberSession } from "@/lib/member-token";
import { useEnsureGuestSession } from "@/hooks/use-guest-session";
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

/** Local storage key for the guest display name — one per browser. */
const GUEST_NAME_KEY = "wwbh:guest-name";

function readGuestName(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(GUEST_NAME_KEY) ?? "";
  } catch {
    return "";
  }
}
function writeGuestName(name: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(GUEST_NAME_KEY, name);
  } catch {
    /* private mode, or the quota is full — the name only lives for this session */
  }
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

  // Guest identity is a server-signed session, not a device id: ownership of a
  // reaction or a comment is decided from the signed token, so a key copied out
  // of someone else's row can't be replayed to delete their trash talk.
  // Minted on mount rather than on first tap: the send needs the signed header,
  // and the name prompt should not be gated on a round trip.
  useEnsureGuestSession(!me);
  const [guestName, setGuestName] = useState<string>("");
  /**
   * The same name, readable synchronously.
   *
   * saveGuestName replays the stashed action in the tick it sets the name, so a
   * replayed handler re-enters ensureIdentity through a closure React has not
   * re-rendered yet — where the name is still empty. Reading state there put the
   * prompt straight back up in front of the guest who had just answered it, and
   * the reaction never landed. Same reason players.pack.tsx latches its pull.
   */
  const guestNameRef = useRef("");
  function rememberGuestName(next: string) {
    guestNameRef.current = next;
    setGuestName(next);
  }
  useEffect(() => {
    rememberGuestName(readGuestName());
  }, []);

  // Ask for a name once, only when the guest actually tries to do something.
  const [namePrompt, setNamePrompt] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [pendingAction, setPendingAction] = useState<null | (() => void)>(null);

  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [bursting, setBursting] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<Record<string, number>>({});

  type Actor = { kind: "member" } | { kind: "guest"; guest: { name: string } };

  /**
   * Resolve who this device is acting as, or open the inline name prompt.
   * Returns null when the caller should abort and wait for a name.
   */
  function ensureIdentity(runAfterNamed: () => void): Actor | null {
    if (me) return { kind: "member" };
    const trimmed = guestNameRef.current.trim();
    if (trimmed.length > 0) {
      return { kind: "guest", guest: { name: trimmed } };
    }
    // Stash so a first-time guest who names themselves picks up where they
    // left off, rather than losing the tap that surfaced the prompt.
    setPendingAction(() => runAfterNamed);
    setNamePrompt(true);
    return null;
  }

  function saveGuestName() {
    const cleaned = nameDraft.trim().slice(0, 40);
    if (!cleaned) return;
    rememberGuestName(cleaned);
    writeGuestName(cleaned);
    setNamePrompt(false);
    setNameDraft("");
    const next = pendingAction;
    setPendingAction(null);
    if (next) next();
  }

  /** Display label for a reaction/comment row, falling back to guest name. */
  function labelFor(row: { participant_id: string | null; guest_name?: string | null }): string {
    if (row.participant_id) return nameOf(row.participant_id);
    return row.guest_name?.trim() || "Guest";
  }

  const mine = useMemo(() => {
    const set = new Set<string>();
    for (const r of reactions) if (r.mine) set.add(r.emoji);
    return set;
  }, [reactions]);

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
    const who = ensureIdentity(() => void onReact(emoji));
    if (!who) return;
    const adding = !mine.has(emoji);
    setPending(emoji);
    setOptimistic((prev) => ({ ...prev, [emoji]: (prev[emoji] ?? 0) + (adding ? 1 : -1) }));
    if (adding && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setBursting(emoji);
      navigator.vibrate?.([8]);
    }
    try {
      await toggleFn({
        data: {
          eventParticipantId,
          emoji,
          guest: who.kind === "guest" ? who.guest : undefined,
        },
      });
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not react");
    } finally {
      setOptimistic((prev) => {
        const next = { ...prev };
        delete next[emoji];
        return next;
      });
      setPending(null);
    }
  }

  async function submitPost() {
    const body = draft.trim();
    if (!body || busy) return;
    const who = ensureIdentity(() => void submitPost());
    if (!who) return;
    setBusy(true);
    try {
      await postFn({
        data: {
          eventParticipantId,
          body,
          guest: who.kind === "guest" ? who.guest : undefined,
        },
      });
      setDraft("");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not post");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(commentId: string) {
    const who = ensureIdentity(() => void onDelete(commentId));
    if (!who) return;
    try {
      await deleteFn({
        data: {
          commentId,
          guest: who.kind === "guest" ? who.guest : undefined,
        },
      });
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete");
    }
  }

  return (
    <div className="mt-8 space-y-6">
      <section>
        <div className="mb-2 text-label font-bold uppercase tracking-[0.08em] text-muted-foreground">
          Reactions
        </div>
        <div className="flex flex-wrap gap-1.5">
          {REACTIONS.map((emoji) => {
            const list = counts.get(emoji) ?? [];
            const active = mine.has(emoji);
            const count = Math.max(0, list.length + (optimistic[emoji] ?? 0));
            return (
              <div key={emoji} className="relative">
                <button
                  onClick={() => onReact(emoji)}
                  disabled={pending === emoji}
                  // The names used to hang off a 20px ⓘ in the chip's corner —
                  // a target nobody standing in a garden could hit, and a second
                  // tappable thing inside a tappable chip. They live on the chip
                  // itself now: read out by a screen reader, and on a long press
                  // by the browser's own tooltip, with no double-firing.
                  aria-label={
                    list.length > 0
                      ? `React with ${emoji}. Reacted by ${list.map((r) => labelFor(r)).join(", ")}`
                      : `React with ${emoji}`
                  }
                  title={list.length > 0 ? list.map((r) => labelFor(r)).join(", ") : undefined}
                  className={cn(
                    "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-sm transition-transform duration-150 active:scale-90 disabled:opacity-50",
                    active
                      ? "border-primary bg-primary/15"
                      : "border-white/10 bg-white/[0.02] hover:border-primary/40",
                  )}
                >
                  <span aria-hidden>{emoji}</span>
                  <span
                    className={cn(
                      "text-meta font-bold tabular",
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

              </div>
            );
          })}
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center gap-1.5 text-label font-bold uppercase tracking-[0.08em] text-muted-foreground">
          <MessageSquare className="h-3.5 w-3.5" />
          Trash Talk
          {comments.length > 0 && <span className="text-primary">{comments.length}</span>}
        </div>

        {comments.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nothing yet. Someone start something.</p>
        ) : (
          <ul className="space-y-1.5">
            {comments.map((c) => {
              const canDelete = !!c.mine;
              return (
                <li
                  key={c.id}
                  className="group flex items-start gap-2 rounded-md border border-white/5 bg-white/[0.02] px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-label font-bold uppercase tracking-[0.08em] text-primary/80">
                      {labelFor(c)}
                    </div>
                    <p className="break-words text-sm text-foreground/90">{c.body}</p>
                  </div>
                  {canDelete && (
                    <button
                      onClick={() => onDelete(c.id)}
                      aria-label="Delete your comment"
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitPost();
          }}
          className="mt-3 flex items-center gap-2"
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, 280))}
            placeholder={`Talk your talk, ${me?.name ?? (guestName || "guest")}…`}
            className="min-w-0 flex-1 rounded-md border border-white/10 bg-white/[0.02] px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus:border-primary/50"
          />
          <button
            type="submit"
            disabled={busy || !draft.trim()}
            aria-label="Post"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-primary/40 bg-primary/10 text-primary transition-colors hover:bg-primary/20 disabled:opacity-40"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>

        {namePrompt && !me && (
          <div className="mt-3 rounded-md border border-primary/30 bg-primary/5 p-3">
            <p className="text-label font-bold uppercase tracking-[0.08em] text-primary">
              What should we call you?
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Shown next to your reactions and comments. Stored on this device only.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                saveGuestName();
              }}
              className="mt-2 flex items-center gap-2"
            >
              <input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value.slice(0, 40))}
                placeholder="Your name"
                className="min-w-0 flex-1 rounded-md border border-white/10 bg-background px-3 py-2 text-sm outline-none focus:border-primary/50"
              />
              <button
                type="submit"
                disabled={!nameDraft.trim()}
                className="min-h-11 shrink-0 rounded-md border border-primary/40 bg-primary/10 px-3 text-label font-bold uppercase tracking-[0.08em] text-primary hover:bg-primary/20 disabled:opacity-40"
              >
                Save
              </button>
            </form>
          </div>
        )}
      </section>
    </div>
  );
}
