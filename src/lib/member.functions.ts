import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { hashCode, signMemberToken } from "./session.server";
import { optionalGuest, requireAdmin, requireMember } from "./require-auth.server";
import { timingSafeEq } from "./session.server";
import { uuid as zuuid } from "./zod-uuid";

// Codes get read off paper and typed on a phone, so the alphabet drops every
// character pair people confuse: 0/O, 1/I/L, 2/Z, 5/S, 8/B.
const CODE_ALPHABET = "ACDEFGHJKMNPQRTUVWXY34679";
const CODE_LENGTH = 6;

function randomCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  // Rejection-free modulo bias is irrelevant at this scale, but keep it uniform
  // enough that codes don't cluster on the early letters.
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

function randomSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Roster for the claim picker: names plus whether each has been claimed yet. */
export const getClaimRoster = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [{ data: participants }, { data: codes }, { data: accounts }] = await Promise.all([
    supabaseAdmin
      .from("participants")
      .select("id, name, nickname")
      .eq("active", true)
      .order("name"),
    supabaseAdmin.from("member_codes").select("participant_id, claimed_at"),
    // Signing into an account is the other way a player gets a device that can
    // answer — and a better one, since it follows them between phones. /claim
    // still cares only about the paper code; trading cares about reachability.
    supabaseAdmin.from("account_identities").select("participant_id"),
  ]);
  const claimed = new Map((codes ?? []).map((c) => [c.participant_id, c.claimed_at]));
  const linked = new Set((accounts ?? []).map((a) => a.participant_id).filter(Boolean));
  return (participants ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    nickname: p.nickname,
    hasCode: claimed.has(p.id),
    claimed: !!claimed.get(p.id),
    /** Somebody an offer can actually reach: claimed a code, or signed in. */
    reachable: !!claimed.get(p.id) || linked.has(p.id),
  }));
});

/**
 * Exchange a commissioner-issued code for a 90-day member token.
 *
 * Codes stay valid after the first claim on purpose — people get new phones and
 * clear browsers, and re-issuing a code for that is worse than the alternative
 * for a 13-person friend group. The commissioner can rotate any code from admin.
 */
export const claimPlayer = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        participantId: zuuid(),
        code: z.string().min(4).max(16),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("member_codes")
      .select("participant_id, code_salt, code_hash, claimed_at, claim_count")
      .eq("participant_id", data.participantId)
      .maybeSingle();

    // Same generic failure for "no code issued" and "wrong code" so the endpoint
    // can't be used to enumerate which players have codes.
    if (!row) return { ok: false as const, reason: "bad_code" as const };
    if (!timingSafeEq(hashCode(row.code_salt, data.code), row.code_hash)) {
      return { ok: false as const, reason: "bad_code" as const };
    }

    const now = new Date().toISOString();
    await supabaseAdmin
      .from("member_codes")
      .update({
        claimed_at: row.claimed_at ?? now,
        last_claimed_at: now,
        claim_count: (row.claim_count ?? 0) + 1,
      })
      .eq("participant_id", data.participantId);

    const { data: participant } = await supabaseAdmin
      .from("participants")
      .select("name")
      .eq("id", data.participantId)
      .maybeSingle();

    // Anything they pulled as a guest is theirs, and now it is on their name
    // rather than on this handset. The guest id comes from the verified guest
    // token, never the payload — otherwise claiming your own player would be a
    // way to harvest somebody else's cards.
    //
    // Swallowed on failure and awaited rather than fired off: a claim that
    // half-worked is worth far less than a claim that worked, and nobody can act
    // on "your old secrets did not come across" in the moment anyway.
    const guestId = optionalGuest();
    if (guestId) {
      try {
        const { secretsDb } = await import("./secret-cards-db.server");
        await secretsDb().rpc("claim_guest_secrets", {
          _participant_id: data.participantId,
          _guest_id: guestId,
        });
        // The packs they tore as a guest are theirs too. Roster cards cannot come
        // across here — they were never stored server-side for a guest — so the
        // device uploads those itself through `adoptCollection` once it holds a
        // member token.
        await secretsDb().rpc("claim_guest_packs", {
          _participant_id: data.participantId,
          _guest_id: guestId,
        });
      } catch {
        /* the claim itself stands; the cards can be reconciled by pulling again */
      }
    }

    const { token, expiresAt } = signMemberToken(data.participantId);
    return { ok: true as const, token, expiresAt, name: participant?.name ?? "Player" };
  });

/** Who am I, according to the token this request carried. */
export const getMe = createServerFn({ method: "GET" }).handler(async () => {
  const participantId = await requireMember();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("participants")
    .select("id, name, nickname, fantasy_team_name")
    .eq("id", participantId)
    .maybeSingle();
  return data;
});

// ---------- Admin ----------

/**
 * Issue a fresh code for every active participant (or just the ones named).
 * Plaintext is returned exactly once — only the salted hash is stored — so the
 * commissioner must copy or print the list before leaving the page.
 */
export const generateMemberCodes = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        eventId: zuuid(),
        participantIds: z.array(zuuid()).max(64).optional(),
        // "unclaimed" leaves already-claimed players' codes alone, so a re-issue
        // for stragglers doesn't invalidate codes people are already using.
        scope: z.enum(["all", "unclaimed"]).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await requireAdmin(data.eventId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let targets: { id: string; name: string }[] = [];
    if (data.participantIds?.length) {
      const { data: rows } = await supabaseAdmin
        .from("participants")
        .select("id, name")
        .in("id", data.participantIds);
      targets = rows ?? [];
    } else {
      const { data: rows } = await supabaseAdmin
        .from("participants")
        .select("id, name")
        .eq("active", true)
        .order("name");
      targets = rows ?? [];
      if (data.scope === "unclaimed") {
        const { data: codes } = await supabaseAdmin
          .from("member_codes")
          .select("participant_id, claimed_at");
        const claimed = new Set(
          (codes ?? []).filter((c) => c.claimed_at).map((c) => c.participant_id),
        );
        targets = targets.filter((t) => !claimed.has(t.id));
      }
    }

    const issued: { participantId: string; name: string; code: string }[] = [];
    for (const t of targets) {
      const code = randomCode();
      const salt = randomSalt();
      const { error } = await supabaseAdmin.from("member_codes").upsert(
        {
          participant_id: t.id,
          code_salt: salt,
          code_hash: hashCode(salt, code),
          // Rotating a code resets the claim record; existing tokens keep working
          // until they expire, which is the intended behaviour for a re-issue.
          claimed_at: null,
          last_claimed_at: null,
          claim_count: 0,
        },
        { onConflict: "participant_id" },
      );
      if (error) throw error;
      issued.push({ participantId: t.id, name: t.name, code });
    }
    return { ok: true, issued };
  });

/** Claim status per player, for the admin console. Never returns code material. */
export const listMemberClaims = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ eventId: zuuid() }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin(data.eventId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin
      .from("member_codes")
      .select("participant_id, claimed_at, last_claimed_at, claim_count");
    return rows ?? [];
  });
