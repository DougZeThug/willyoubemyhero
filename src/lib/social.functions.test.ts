// Reactions, trash talk, and the secret ballot.
//
// Reactions and comments are public by design; award votes are not. The
// authorization on each of these matters, because every one of them runs as
// service_role with RLS out of the picture.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseResponses } from "@/test/supabase-mock";
import { adminHeaders, callServerFn, memberHeaders } from "@/test/server-fn";
import { signAdminToken, signMemberToken } from "./session.server";
import { AWARD_CATEGORIES } from "./awards";

let mock = createSupabaseMock();

vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return mock.client;
  },
}));

const EVENT_ID = "00000000-0000-4000-8000-0000000000ff";
const OTHER_EVENT_ID = "00000000-0000-4000-8000-0000000000ee";
const CARD_ID = "00000000-0000-4000-8000-000000000011";
const ME = "00000000-0000-4000-8000-0000000000aa";
const THEM = "00000000-0000-4000-8000-0000000000bb";
const COMMENT_ID = "00000000-0000-4000-8000-000000000022";

function withDb(responses: SupabaseResponses = {}) {
  mock = createSupabaseMock(responses);
}

const asMe = () => memberHeaders(signMemberToken(ME).token);
const asAdmin = (eventId = EVENT_ID) => adminHeaders(signAdminToken(eventId).token);

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-session-secret");
  withDb();
});

describe("getEventSocial", () => {
  it("returns empty lists for an event with no participants", async () => {
    withDb({ "event_participants.select": { data: [] } });
    const { getEventSocial } = await import("./social.functions");
    expect(await callServerFn(getEventSocial, { data: { eventId: EVENT_ID } })).toEqual({
      reactions: [],
      comments: [],
    });
  });

  it("scopes reactions and comments to this event's cards", async () => {
    withDb({
      "event_participants.select": { data: [{ id: CARD_ID }] },
      "card_reactions.select": { data: [{ id: "r1", emoji: "🔥" }] },
      "card_comments.select": { data: [{ id: "c1", body: "hi" }] },
    });
    const { getEventSocial } = await import("./social.functions");
    const res = await callServerFn(getEventSocial, { data: { eventId: EVENT_ID } });
    expect(res).toEqual({
      reactions: [{ id: "r1", emoji: "🔥" }],
      comments: [{ id: "c1", body: "hi" }],
    });
    for (const table of ["card_reactions", "card_comments"]) {
      const [call] = mock.callsFor(table, "select");
      expect(call.filters.find((f) => f.method === "in")?.args).toEqual([
        "event_participant_id",
        [CARD_ID],
      ]);
    }
  });

  it("is readable without a session — attribution is the point", async () => {
    withDb({ "event_participants.select": { data: [] } });
    const { getEventSocial } = await import("./social.functions");
    await expect(
      callServerFn(getEventSocial, { data: { eventId: EVENT_ID } }),
    ).resolves.toBeTruthy();
  });
});

describe("toggleReaction", () => {
  async function toggle(data: unknown, headers?: Record<string, string>) {
    const { toggleReaction } = await import("./social.functions");
    return callServerFn(toggleReaction, { data, headers });
  }

  it("requires a member or guest identity", async () => {
    await expect(toggle({ eventParticipantId: CARD_ID, emoji: "🔥" })).rejects.toThrow(
      "Claim your player or add a name to join in",
    );
  });

  it("adds a reaction that is not there yet", async () => {
    withDb({ "card_reactions.select": { data: null } });
    expect(await toggle({ eventParticipantId: CARD_ID, emoji: "🔥" }, asMe())).toEqual({
      ok: true,
      reacted: true,
    });
    expect(mock.callsFor("card_reactions", "insert")[0].payload).toEqual({
      event_participant_id: CARD_ID,
      participant_id: ME,
      emoji: "🔥",
    });
  });

  it("removes a reaction it already owns", async () => {
    withDb({ "card_reactions.select": { data: { id: "r1" } } });
    expect(await toggle({ eventParticipantId: CARD_ID, emoji: "🔥" }, asMe())).toEqual({
      ok: true,
      reacted: false,
    });
    expect(mock.callsFor("card_reactions", "delete")).toHaveLength(1);
  });

  it("attributes the reaction to the token holder, not to a caller-supplied id", async () => {
    withDb({ "card_reactions.select": { data: null } });
    await toggle({ eventParticipantId: CARD_ID, emoji: "🔥", participantId: THEM }, asMe());
    const payload = mock.callsFor("card_reactions", "insert")[0].payload as Record<string, string>;
    expect(payload.participant_id).toBe(ME);
  });

  it("only accepts the six league reactions", async () => {
    await expect(toggle({ eventParticipantId: CARD_ID, emoji: "🍕" }, asMe())).rejects.toThrow();
    await expect(toggle({ eventParticipantId: CARD_ID, emoji: "" }, asMe())).rejects.toThrow();
  });

  it("surfaces an insert failure", async () => {
    withDb({
      "card_reactions.select": { data: null },
      "card_reactions.insert": { error: { message: "unique violation" } },
    });
    await expect(toggle({ eventParticipantId: CARD_ID, emoji: "🔥" }, asMe())).rejects.toBeTruthy();
  });
});

describe("postComment", () => {
  async function post(data: unknown, headers?: Record<string, string>) {
    const { postComment } = await import("./social.functions");
    return callServerFn(postComment, { data, headers });
  }

  it("requires a member or guest identity", async () => {
    await expect(post({ eventParticipantId: CARD_ID, body: "hi" })).rejects.toThrow(
      "Claim your player or add a name to join in",
    );
  });

  it("stores the comment against the token holder", async () => {
    withDb({ "card_comments.insert": { data: { id: COMMENT_ID }, error: null } });
    expect(await post({ eventParticipantId: CARD_ID, body: "get wrecked" }, asMe())).toEqual({
      ok: true,
      comment: { id: COMMENT_ID },
    });
    expect(mock.callsFor("card_comments", "insert")[0].payload).toEqual({
      event_participant_id: CARD_ID,
      participant_id: ME,
      body: "get wrecked",
    });
  });

  it("trims the body before storing it", async () => {
    withDb({ "card_comments.insert": { data: { id: COMMENT_ID }, error: null } });
    await post({ eventParticipantId: CARD_ID, body: "   spaced out   " }, asMe());
    const payload = mock.callsFor("card_comments", "insert")[0].payload as Record<string, string>;
    expect(payload.body).toBe("spaced out");
  });

  it("rejects an empty or whitespace-only body", async () => {
    await expect(post({ eventParticipantId: CARD_ID, body: "" }, asMe())).rejects.toThrow();
    await expect(post({ eventParticipantId: CARD_ID, body: "   " }, asMe())).rejects.toThrow();
  });

  it("rejects a body over 280 characters", async () => {
    await expect(
      post({ eventParticipantId: CARD_ID, body: "x".repeat(281) }, asMe()),
    ).rejects.toThrow();
  });

  it("accepts exactly 280 characters", async () => {
    withDb({ "card_comments.insert": { data: { id: COMMENT_ID }, error: null } });
    await expect(
      post({ eventParticipantId: CARD_ID, body: "x".repeat(280) }, asMe()),
    ).resolves.toMatchObject({ ok: true });
  });
});

describe("deleteComment", () => {
  async function del(headers?: Record<string, string>) {
    const { deleteComment } = await import("./social.functions");
    return callServerFn(deleteComment, { data: { commentId: COMMENT_ID }, headers });
  }

  function commentBy(participantId: string, eventId: string | null = EVENT_ID) {
    return {
      "card_comments.select": {
        data: {
          id: COMMENT_ID,
          participant_id: participantId,
          event_participant: eventId ? { event_id: eventId } : null,
        },
        error: null,
      },
    };
  }

  it("is a no-op for a comment that no longer exists", async () => {
    withDb({ "card_comments.select": { data: null } });
    expect(await del(asMe())).toEqual({ ok: true });
    expect(mock.callsFor("card_comments", "delete")).toHaveLength(0);
  });

  it("lets you delete your own trash talk", async () => {
    withDb(commentBy(ME));
    expect(await del(asMe())).toEqual({ ok: true });
    expect(mock.callsFor("card_comments", "delete")).toHaveLength(1);
  });

  it("refuses to delete someone else's", async () => {
    withDb(commentBy(THEM));
    await expect(del(asMe())).rejects.toThrow("Not your comment");
    expect(mock.callsFor("card_comments", "delete")).toHaveLength(0);
  });

  it("lets the commissioner delete anyone's", async () => {
    withDb(commentBy(THEM));
    expect(await del(asAdmin())).toEqual({ ok: true });
    expect(mock.callsFor("card_comments", "delete")).toHaveLength(1);
  });

  it("authorises against the comment's own event, not one the caller names", async () => {
    // An admin for event A must not be able to delete comments on event B.
    // The handler reads event_id off the joined row precisely for this.
    withDb(commentBy(THEM, OTHER_EVENT_ID));
    await expect(del(asAdmin(EVENT_ID))).rejects.toThrow();
    expect(mock.callsFor("card_comments", "delete")).toHaveLength(0);
  });

  it("falls back to ownership when the comment's event cannot be resolved", async () => {
    // No event id means no admin claim can apply, so the caller has to own it.
    // An admin token alone does not own the comment, so it is rejected.
    withDb(commentBy(THEM, null));
    await expect(del(asAdmin())).rejects.toThrow("Not your comment");

    withDb(commentBy(THEM, null));
    await expect(del({ ...asAdmin(), ...asMe() })).rejects.toThrow("Not your comment");

    withDb(commentBy(ME, null));
    await expect(del(asMe())).resolves.toEqual({ ok: true });
  });

  it("requires some session at all", async () => {
    withDb(commentBy(ME));
    await expect(del()).rejects.toThrow("Not your comment");
  });
});

describe("award voting", () => {
  it("keeps a ballot private to its voter", async () => {
    withDb({ "award_votes.select": { data: [{ category: "mvp", target_participant_id: THEM }] } });
    const { getMyAwardVotes } = await import("./social.functions");
    await callServerFn(getMyAwardVotes, { data: { eventId: EVENT_ID }, headers: asMe() });
    const [call] = mock.callsFor("award_votes", "select");
    expect(mock.eqValue(call, "voter_participant_id")).toBe(ME);
  });

  it("will not hand out a ballot without a member token", async () => {
    const { getMyAwardVotes } = await import("./social.functions");
    await expect(callServerFn(getMyAwardVotes, { data: { eventId: EVENT_ID } })).rejects.toThrow(
      "Claim your player first",
    );
  });

  describe("castAwardVote", () => {
    async function cast(data: unknown, headers?: Record<string, string>) {
      const { castAwardVote } = await import("./social.functions");
      return callServerFn(castAwardVote, { data, headers });
    }

    const validVote = {
      eventId: EVENT_ID,
      category: "mvp",
      targetParticipantId: THEM,
    };

    it("requires a claimed player", async () => {
      await expect(cast(validVote)).rejects.toThrow("Claim your player first");
    });

    it("rejects a category that is not a real award", async () => {
      await expect(cast({ ...validVote, category: "best_hair" }, asMe())).rejects.toThrow(
        "Unknown award category",
      );
      expect(mock.client.rpc).not.toHaveBeenCalled();
    });

    it("goes through the locking RPC rather than writing the table directly", async () => {
      // The RPC locks the event row and re-checks awards_locked, so a vote
      // cannot slip in between close_award_voting's check and its tally.
      await cast(validVote, asMe());
      expect(mock.client.rpc).toHaveBeenCalledWith("cast_award_vote", {
        _event_id: EVENT_ID,
        _category: "mvp",
        _voter_participant_id: ME,
        _target_participant_id: THEM,
      });
      expect(mock.callsFor("award_votes", "insert")).toHaveLength(0);
    });

    it("votes as the token holder, whatever the payload claims", async () => {
      await cast({ ...validVote, voterParticipantId: THEM }, asMe());
      expect(mock.client.rpc).toHaveBeenCalledWith(
        "cast_award_vote",
        expect.objectContaining({ _voter_participant_id: ME }),
      );
    });

    it("surfaces the RPC's own refusal, e.g. voting once it is locked", async () => {
      withDb({ "rpc.cast_award_vote": { error: { message: "voting is closed" } } });
      await expect(cast(validVote, asMe())).rejects.toThrow("voting is closed");
    });

    it("accepts every published category", async () => {
      for (const category of AWARD_CATEGORIES) {
        await expect(cast({ ...validVote, category: category.id }, asMe())).resolves.toEqual({
          ok: true,
        });
      }
    });
  });

  describe("getAwardTally", () => {
    it("is commissioner-only, so the room cannot see it before the reveal", async () => {
      const { getAwardTally } = await import("./social.functions");
      await expect(callServerFn(getAwardTally, { data: { eventId: EVENT_ID } })).rejects.toThrow(
        "Admin PIN required",
      );
    });

    it("is not readable by an ordinary member", async () => {
      const { getAwardTally } = await import("./social.functions");
      await expect(
        callServerFn(getAwardTally, { data: { eventId: EVENT_ID }, headers: asMe() }),
      ).rejects.toThrow("Admin PIN required");
    });

    it("counts votes per category per nominee", async () => {
      withDb({
        "award_votes.select": {
          data: [
            { category: "mvp", target_participant_id: ME },
            { category: "mvp", target_participant_id: ME },
            { category: "mvp", target_participant_id: THEM },
            { category: "clutch", target_participant_id: THEM },
          ],
        },
      });
      const { getAwardTally } = await import("./social.functions");
      expect(
        await callServerFn(getAwardTally, { data: { eventId: EVENT_ID }, headers: asAdmin() }),
      ).toEqual({
        tally: {
          mvp: { [ME]: 2, [THEM]: 1 },
          clutch: { [THEM]: 1 },
        },
        totalVotes: 4,
      });
    });

    it("reports an empty tally before anyone has voted", async () => {
      const { getAwardTally } = await import("./social.functions");
      expect(
        await callServerFn(getAwardTally, { data: { eventId: EVENT_ID }, headers: asAdmin() }),
      ).toEqual({ tally: {}, totalVotes: 0 });
    });
  });

  describe("closeAwardVoting / reopenAwardVoting", () => {
    it("both refuse without an admin token", async () => {
      const { closeAwardVoting, reopenAwardVoting } = await import("./social.functions");
      await expect(callServerFn(closeAwardVoting, { data: { eventId: EVENT_ID } })).rejects.toThrow(
        "Admin PIN required",
      );
      await expect(
        callServerFn(reopenAwardVoting, { data: { eventId: EVENT_ID } }),
      ).rejects.toThrow("Admin PIN required");
    });

    it("hands the RPC every category, so nothing is silently unpublishable", async () => {
      withDb({ "rpc.close_award_voting": { data: 6 } });
      const { closeAwardVoting } = await import("./social.functions");
      expect(
        await callServerFn(closeAwardVoting, { data: { eventId: EVENT_ID }, headers: asAdmin() }),
      ).toEqual({ ok: true, published: 6 });
      expect(mock.client.rpc).toHaveBeenCalledWith("close_award_voting", {
        _event_id: EVENT_ID,
        _categories: AWARD_CATEGORIES.map((c) => ({ id: c.id, label: c.label })),
      });
    });

    it("reports zero published when the RPC returns nothing", async () => {
      const { closeAwardVoting } = await import("./social.functions");
      expect(
        await callServerFn(closeAwardVoting, { data: { eventId: EVENT_ID }, headers: asAdmin() }),
      ).toEqual({ ok: true, published: 0 });
    });

    it("surfaces an RPC failure instead of claiming success", async () => {
      withDb({ "rpc.close_award_voting": { error: { message: "already locked" } } });
      const { closeAwardVoting } = await import("./social.functions");
      await expect(
        callServerFn(closeAwardVoting, { data: { eventId: EVENT_ID }, headers: asAdmin() }),
      ).rejects.toThrow("already locked");
    });

    it("reopens through its own RPC", async () => {
      const { reopenAwardVoting } = await import("./social.functions");
      expect(
        await callServerFn(reopenAwardVoting, { data: { eventId: EVENT_ID }, headers: asAdmin() }),
      ).toEqual({ ok: true });
      expect(mock.client.rpc).toHaveBeenCalledWith("reopen_award_voting", { _event_id: EVENT_ID });
    });
  });

  describe("getAwards", () => {
    it("is public — this is what renders on cards and the recap", async () => {
      withDb({ "awards.select": { data: [{ id: "a1", award_name: "MVP" }] } });
      const { getAwards } = await import("./social.functions");
      await expect(callServerFn(getAwards, { data: { eventId: EVENT_ID } })).resolves.toEqual([
        { id: "a1", award_name: "MVP" },
      ]);
    });

    it("returns an empty list before anything is published", async () => {
      const { getAwards } = await import("./social.functions");
      await expect(callServerFn(getAwards, { data: { eventId: EVENT_ID } })).resolves.toEqual([]);
    });
  });
});
