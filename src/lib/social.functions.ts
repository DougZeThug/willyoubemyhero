import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { isAdminFor, optionalMember, requireAdmin, requireMember } from "./require-auth.server";
import { AWARD_CATEGORIES, isAwardCategory } from "./awards";

/**
 * Reactions, trash talk, and superlative voting.
 *
 * Reactions and comments are publicly readable — attribution is the point.
 * Award votes are not: they are a secret ballot, readable only by the
 * commissioner and only as a tally, until voting is closed and winners are
 * written into the public `awards` table.
 */

const REACTIONS = ["🔥", "💀", "😂", "🐐", "🤡", "🍺"] as const;
const reactionEmoji = z.enum(REACTIONS);
export const REACTION_EMOJIS: readonly string[] = REACTIONS;

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/**
 * Guest identity forwarded from the browser. `key` is `d:<deviceId>`, minted
 * per device and stable across reloads. `name` is what the guest typed the
 * first time they wanted to say something.
 *
 * A member session always wins over a guest identity in the same request, so
 * signing in later can't silently double up your reactions.
 */
const guestSchema = z
  .object({
    key: z.string().trim().min(4).max(80),
    name: z.string().trim().min(1).max(40),
  })
  .optional();
type GuestInput = z.infer<typeof guestSchema>;

function actor(input: GuestInput): {
  member: string | null;
  guest: { key: string; name: string } | null;
} {
  const member = optionalMember();
  if (member) return { member, guest: null };
  if (!input) throw new Error("Claim your player or add a name to join in");
  return { member: null, guest: input };
}

/** Every reaction and comment for one event, in a single round trip. */
export const getEventSocial = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ eventId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const sb = await admin();
    const { data: eps } = await sb
      .from("event_participants")
      .select("id")
      .eq("event_id", data.eventId);
    const ids = (eps ?? []).map((e) => e.id);
    if (ids.length === 0) return { reactions: [], comments: [] };

    const [{ data: reactions }, { data: comments }] = await Promise.all([
      sb
        .from("card_reactions")
        .select("id, event_participant_id, participant_id, guest_key, guest_name, emoji, created_at")
        .in("event_participant_id", ids),
      sb
        .from("card_comments")
        .select("id, event_participant_id, participant_id, guest_key, guest_name, body, created_at")
        .in("event_participant_id", ids)
        .order("created_at", { ascending: true }),
    ]);
    return { reactions: reactions ?? [], comments: comments ?? [] };
  });

/** Add or remove one of your reactions on a card. Returns the new state. */
export const toggleReaction = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        eventParticipantId: z.string().uuid(),
        emoji: reactionEmoji,
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const me = await requireMember();
    const sb = await admin();
    const { data: existing } = await sb
      .from("card_reactions")
      .select("id")
      .eq("event_participant_id", data.eventParticipantId)
      .eq("participant_id", me)
      .eq("emoji", data.emoji)
      .maybeSingle();

    if (existing) {
      await sb.from("card_reactions").delete().eq("id", existing.id);
      return { ok: true as const, reacted: false as const };
    }
    const { error } = await sb.from("card_reactions").insert({
      event_participant_id: data.eventParticipantId,
      participant_id: me,
      emoji: data.emoji,
    });
    if (error) throw error;
    return { ok: true as const, reacted: true as const };
  });

export const postComment = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        eventParticipantId: z.string().uuid(),
        body: z.string().trim().min(1).max(280),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const me = await requireMember();
    const sb = await admin();
    const { data: row, error } = await sb
      .from("card_comments")
      .insert({
        event_participant_id: data.eventParticipantId,
        participant_id: me,
        body: data.body,
      })
      .select()
      .single();
    if (error) throw error;
    return { ok: true, comment: row };
  });

/** You can delete your own trash talk; the commissioner can delete anyone's. */
export const deleteComment = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ commentId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const sb = await admin();
    const { data: row } = await sb
      .from("card_comments")
      .select("id, participant_id, event_participant:event_participants!inner(event_id)")
      .eq("id", data.commentId)
      .maybeSingle<{
        id: string;
        participant_id: string;
        event_participant: { event_id: string } | null;
      }>();
    if (!row) return { ok: true };

    // Authorize against the comment's actual event, not a caller-supplied one —
    // otherwise an admin for event A could delete comments belonging to event B.
    const eventId = row.event_participant?.event_id ?? null;
    if (!eventId || !isAdminFor(eventId)) {
      const me = await requireMember();
      if (row.participant_id !== me) throw new Error("Not your comment");
    }
    await sb.from("card_comments").delete().eq("id", data.commentId);
    return { ok: true };
  });

// ---------- Superlative voting ----------

/** Your own ballot. Only ever returns the requesting member's votes. */
export const getMyAwardVotes = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ eventId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const me = await requireMember();
    const sb = await admin();
    const { data: rows } = await sb
      .from("award_votes")
      .select("category, target_participant_id")
      .eq("event_id", data.eventId)
      .eq("voter_participant_id", me);
    return rows ?? [];
  });

/**
 * Cast or change your vote in one category. The unique constraint on
 * (event_id, category, voter_participant_id) is what actually enforces one vote
 * per member per category — the upsert just makes changing your mind work.
 */
export const castAwardVote = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        eventId: z.string().uuid(),
        category: z.string().min(1).max(40),
        targetParticipantId: z.string().uuid(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const me = await requireMember();
    if (!isAwardCategory(data.category)) throw new Error("Unknown award category");
    const sb = await admin();

    // The RPC locks the event row, re-checks awards_locked, verifies the
    // nominee is on the roster, and upserts the vote in one transaction —
    // so a vote can't slip in between close_award_voting's lock check and
    // its final tally.
    const { error } = await sb.rpc("cast_award_vote", {
      _event_id: data.eventId,
      _category: data.category,
      _voter_participant_id: me,
      _target_participant_id: data.targetParticipantId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Published winners. Public — this is what renders on cards and the recap. */
export const getAwards = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ eventId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const sb = await admin();
    const { data: rows } = await sb
      .from("awards")
      .select("id, event_id, participant_id, award_name, award_type, description")
      .eq("event_id", data.eventId);
    return rows ?? [];
  });

/** Live tally. Commissioner only, so the room can't see it before the reveal. */
export const getAwardTally = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ eventId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin(data.eventId);
    const sb = await admin();
    const { data: rows } = await sb
      .from("award_votes")
      .select("category, target_participant_id")
      .eq("event_id", data.eventId);
    const tally: Record<string, Record<string, number>> = {};
    for (const r of rows ?? []) {
      tally[r.category] ??= {};
      tally[r.category][r.target_participant_id] =
        (tally[r.category][r.target_participant_id] ?? 0) + 1;
    }
    return { tally, totalVotes: rows?.length ?? 0 };
  });

/**
 * Close voting and publish winners into the existing `awards` table.
 *
 * Ties are published as joint winners rather than broken arbitrarily — with 13
 * voters a tie is common and picking a winner by row order would be a lie.
 */
export const closeAwardVoting = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ eventId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin(data.eventId);
    const sb = await admin();
    // Tally + publish + lock happen inside close_award_voting, which takes a
    // row lock on the event so an in-flight cast_award_vote either finishes
    // first (and is counted) or waits until we're done (and then sees
    // awards_locked). No vote is silently dropped.
    const { data: published, error } = await sb.rpc("close_award_voting", {
      _event_id: data.eventId,
      _categories: AWARD_CATEGORIES.map((c) => ({ id: c.id, label: c.label })),
    });
    if (error) throw new Error(error.message);
    return { ok: true, published: published ?? 0 };
  });

/** Reopen voting and unpublish, for when someone was left out. */
export const reopenAwardVoting = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ eventId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin(data.eventId);
    const sb = await admin();
    const { error } = await sb.rpc("reopen_award_voting", { _event_id: data.eventId });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
