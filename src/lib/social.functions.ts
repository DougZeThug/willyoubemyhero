import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  isAdminFor,
  optionalGuest,
  optionalMember,
  requireActor,
  requireAdmin,
  requireMember,
  type Actor,
} from "./require-auth.server";
import { AWARD_CATEGORIES, isAwardCategory } from "./awards";
import { uuid as zuuid } from "./zod-uuid";
import { adminDb } from "./admin-db.server";

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

/**
 * Display name a guest typed for themselves. The identity itself is NOT taken
 * from here: `key` is accepted for compatibility with older clients and
 * deliberately ignored, because anything the caller supplies can be copied off
 * somebody else and replayed. The guest id comes from the signed
 * `x-guest-token` header instead, the same way the daily secret pull works.
 *
 * A member session always wins over a guest identity in the same request. That
 * alone does not stop signing in later from doubling up your reactions: the
 * lookup in toggleReaction only searches the request's own identity, so a 🔥
 * left as a guest is invisible to the member tapping it again. What stops it is
 * the claim — attach_device_to_player, bind_account_to_player and
 * merge_guest_into_collector all move the guest's reactions and comments onto
 * the player (claim_guest_social, 20260924130000), and from then on the
 * database refuses a reaction or comment from that guest id — including one
 * that was already in flight when the claim ran (20260924140000).
 */
const guestSchema = z
  .object({
    key: z.string().trim().max(80).optional(),
    name: z.string().trim().min(1).max(40).optional(),
  })
  .optional();
type GuestInput = z.infer<typeof guestSchema>;

const JOIN_IN_MESSAGE = "Claim your player or add a name to join in";

/** The author columns of a reaction or comment row; a guest's name is what they typed, if anything. */
function authorColumns(actor: Actor, input: GuestInput) {
  return actor.kind === "member"
    ? { participant_id: actor.id }
    : {
        participant_id: null,
        guest_key: actor.id,
        guest_name: input?.name?.trim() || "Guest",
      };
}

/** Every reaction and comment for one event, in a single round trip. */
export const getEventSocial = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ eventId: zuuid() }).parse(d))
  .handler(async ({ data }) => {
    const sb = await adminDb();
    const { data: eps } = await sb
      .from("event_participants")
      .select("id")
      .eq("event_id", data.eventId);
    const ids = (eps ?? []).map((e) => e.id);
    if (ids.length === 0) return { reactions: [], comments: [] };

    const [{ data: reactions }, { data: comments }] = await Promise.all([
      sb
        .from("card_reactions")
        .select(
          "id, event_participant_id, participant_id, guest_key, guest_name, emoji, created_at",
        )
        .in("event_participant_id", ids),
      sb
        .from("card_comments")
        .select("id, event_participant_id, participant_id, guest_key, guest_name, body, created_at")
        .in("event_participant_id", ids)
        .order("created_at", { ascending: true }),
    ]);

    // guest_key never leaves the server: this endpoint is public, and a guest key
    // that anyone can read is a guest anyone can act as. The client only needs to
    // know which rows are its own, so resolve that here against the verified
    // identity on the request and strip the key itself.
    const meMember = optionalMember();
    const meGuest = meMember ? null : optionalGuest();
    const isMine = (row: { participant_id: string | null; guest_key: string | null }) =>
      meMember ? row.participant_id === meMember : Boolean(meGuest) && row.guest_key === meGuest;

    return {
      reactions: (reactions ?? []).map(({ guest_key, ...r }) => ({
        ...r,
        mine: isMine({ participant_id: r.participant_id, guest_key }),
      })),
      comments: (comments ?? []).map(({ guest_key, ...c }) => ({
        ...c,
        mine: isMine({ participant_id: c.participant_id, guest_key }),
      })),
    };
  });

/** Add or remove one of your reactions on a card. Returns the new state. */
export const toggleReaction = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        eventParticipantId: zuuid(),
        emoji: reactionEmoji,
        guest: guestSchema,
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const actor = requireActor(JOIN_IN_MESSAGE);
    const sb = await adminDb();
    const reactionQuery = sb
      .from("card_reactions")
      .select("id")
      .eq("event_participant_id", data.eventParticipantId)
      .eq("emoji", data.emoji);
    const { data: existing } =
      actor.kind === "member"
        ? await reactionQuery.eq("participant_id", actor.id).maybeSingle()
        : await reactionQuery.eq("guest_key", actor.id).maybeSingle();

    if (existing) {
      await sb.from("card_reactions").delete().eq("id", existing.id);
      return { ok: true as const, reacted: false as const };
    }
    const { error } = await sb.from("card_reactions").insert({
      event_participant_id: data.eventParticipantId,
      emoji: data.emoji,
      ...authorColumns(actor, data.guest),
    });
    if (error) throw error;
    return { ok: true as const, reacted: true as const };
  });

export const postComment = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        eventParticipantId: zuuid(),
        body: z.string().trim().min(1).max(280),
        guest: guestSchema,
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const actor = requireActor(JOIN_IN_MESSAGE);
    const sb = await adminDb();
    const { data: row, error } = await sb
      .from("card_comments")
      .insert({
        event_participant_id: data.eventParticipantId,
        body: data.body,
        ...authorColumns(actor, data.guest),
      })
      .select()
      .single();
    if (error) throw error;
    return { ok: true, comment: row };
  });

/** You can delete your own trash talk; the commissioner can delete anyone's. */
export const deleteComment = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ commentId: zuuid(), guest: guestSchema }).parse(d))
  .handler(async ({ data }) => {
    const sb = await adminDb();
    const { data: row } = await sb
      .from("card_comments")
      .select("id, participant_id, guest_key, event_participant:event_participants!inner(event_id)")
      .eq("id", data.commentId)
      .maybeSingle<{
        id: string;
        participant_id: string | null;
        guest_key: string | null;
        event_participant: { event_id: string } | null;
      }>();
    if (!row) return { ok: true };

    // Authorize against the comment's actual event, not a caller-supplied one —
    // otherwise an admin for event A could delete comments belonging to event B.
    const eventId = row.event_participant?.event_id ?? null;
    if (!eventId || !(await isAdminFor(eventId))) {
      const me = optionalMember();
      const isOwnMember = Boolean(me) && row.participant_id === me;
      // Guest ownership is decided by the signed token, never by a key in the
      // request body — that key is copyable and used to be readable publicly.
      const guestId = me ? null : optionalGuest();
      const isOwnGuest = Boolean(guestId) && Boolean(row.guest_key) && row.guest_key === guestId;
      if (!isOwnMember && !isOwnGuest) throw new Error("Not your comment");
    }
    await sb.from("card_comments").delete().eq("id", data.commentId);
    return { ok: true };
  });

/** Your own ballot. Only ever returns the requesting member's votes. */
export const getMyAwardVotes = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ eventId: zuuid() }).parse(d))
  .handler(async ({ data }) => {
    const me = await requireMember();
    const sb = await adminDb();
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
  .validator((d: unknown) =>
    z
      .object({
        eventId: zuuid(),
        category: z.string().min(1).max(40),
        targetParticipantId: zuuid(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const me = await requireMember();
    if (!isAwardCategory(data.category)) throw new Error("Unknown award category");
    const sb = await adminDb();

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

/**
 * Published winners. Public — this is what renders on cards and the recap.
 *
 * `lockedAtRead` rides along because an empty list means two different things and
 * the reveal has to tell them apart: nobody voted, or the winners have not been
 * published yet. The event row carries `awards_locked`, but a *separately* fetched
 * flag cannot answer it — /awards reads that one from the bundle, on its own
 * timer, so the lock can flip while the tally in hand still predates it. Read
 * here, the answer is about THIS list.
 *
 * The lock is read BEFORE the rows, and that order is the whole guarantee.
 * close_award_voting inserts every award and only then sets awards_locked, in one
 * transaction — so a lock that reads true means the rows below are already
 * committed and this read will see them. Reversed, a close landing between the two
 * would return an empty list stamped `lockedAtRead: true`, which is precisely the
 * reveal announcing that nobody voted over a vote that had winners.
 */
export const getAwards = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ eventId: zuuid() }).parse(d))
  .handler(async ({ data }) => {
    const sb = await adminDb();
    const { data: ev } = await sb
      .from("events")
      .select("awards_locked")
      .eq("id", data.eventId)
      .maybeSingle();
    const { data: rows } = await sb
      .from("awards")
      .select("id, event_id, participant_id, award_name, award_type, description")
      .eq("event_id", data.eventId);
    return { awards: rows ?? [], lockedAtRead: Boolean(ev?.awards_locked) };
  });

/** Live tally. Commissioner only, so the room can't see it before the reveal. */
export const getAwardTally = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ eventId: zuuid() }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin(data.eventId);
    const sb = await adminDb();
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
  .validator((d: unknown) => z.object({ eventId: zuuid() }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin(data.eventId);
    const sb = await adminDb();
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
  .validator((d: unknown) => z.object({ eventId: zuuid() }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin(data.eventId);
    const sb = await adminDb();
    const { error } = await sb.rpc("reopen_award_voting", { _event_id: data.eventId });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
