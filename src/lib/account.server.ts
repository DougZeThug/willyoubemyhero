// Accounts sit on top of the token schemes rather than replacing them.
//
// Every server function, guard and RPC in this app identifies a collection by a
// participant id or a server-minted guest id, carried in a signed token in local
// storage. That works beautifully on one phone and not at all on a second one.
//
// An account (a Supabase auth user) is therefore not a new identity: it is a
// durable *record of which identity you are*. Signing in on a fresh handset hands
// that phone back the same member or guest token it would have had all along, so
// nothing downstream has to know accounts exist.
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
// The streak claims are not in types.ts yet, so they need the widened client.
import { streaksDb } from "./streaks-db.server";
import { signGuestToken, signMemberToken } from "./session.server";

export type AccountIdentity = {
  kind: "member" | "guest";
  /** participant id for a member, guest id for a guest. */
  id: string;
};

export type AccountSession = AccountIdentity & {
  token: string;
  expiresAt: number;
  /** Roster name, when the account is bound to a claimed player. */
  name: string | null;
};

type Row = { user_id: string; participant_id: string | null; guest_id: string | null };

async function readRow(userId: string): Promise<Row | null> {
  const { data } = await supabaseAdmin
    .from("account_identities")
    .select("user_id, participant_id, guest_id")
    .eq("user_id", userId)
    .maybeSingle();
  return data ?? null;
}

function toIdentity(row: Row): AccountIdentity {
  return row.participant_id
    ? { kind: "member", id: row.participant_id }
    : { kind: "guest", id: row.guest_id! };
}

async function mergeGuestInto(identity: AccountIdentity, guestId: string) {
  if (identity.kind === "guest" && identity.id === guestId) return;
  if (identity.kind === "member") {
    const { error: secretsError } = await supabaseAdmin.rpc("claim_guest_secrets", {
      _participant_id: identity.id,
      _guest_id: guestId,
    });
    if (secretsError) throw secretsError;
    const { error: packsError } = await supabaseAdmin.rpc("claim_guest_packs", {
      _participant_id: identity.id,
      _guest_id: guestId,
    });
    if (packsError) throw packsError;
    // Must follow the packs, and must never be skipped: the streak walks the rows
    // claim_guest_packs just re-parented, so a claim left behind on the dead guest
    // id reads as unclaimed on this identity and pays its milestone a second time.
    const { error: streakError } = await streaksDb().rpc("claim_guest_streak_milestones", {
      _participant_id: identity.id,
      _guest_id: guestId,
    });
    if (streakError) throw streakError;
  } else {
    const { error: secretsError } = await supabaseAdmin.rpc("merge_guest_pulls", {
      _into_guest: identity.id,
      _from_guest: guestId,
    });
    if (secretsError) throw secretsError;
    const { error: packsError } = await supabaseAdmin.rpc("merge_guest_packs", {
      _into_guest: identity.id,
      _from_guest: guestId,
    });
    if (packsError) throw packsError;
    const { error: streakError } = await streaksDb().rpc("merge_guest_streak_milestones", {
      _into_guest: identity.id,
      _from_guest: guestId,
    });
    if (streakError) throw streakError;
  }
}

async function nameFor(participantId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("participants")
    .select("name")
    .eq("id", participantId)
    .maybeSingle();
  return data?.name ?? null;
}

function mint(identity: AccountIdentity, name: string | null): AccountSession {
  const { token, expiresAt } =
    identity.kind === "member" ? signMemberToken(identity.id) : signGuestToken(identity.id);
  return { ...identity, token, expiresAt, name };
}

/**
 * Resolve (and, first time, adopt) the identity behind an account.
 *
 * The device's own tokens are inputs, never authority: they arrive already
 * verified from `optionalMember` / `optionalGuest`, which read them off signed
 * headers. A payload-supplied id here would let anybody adopt somebody else's
 * collection simply by naming it.
 */
export async function syncAccount(
  userId: string,
  device: { memberId: string | null; guestIds: string[] },
): Promise<AccountSession> {
  let row = await readRow(userId);
  const guestIds = [...new Set(device.guestIds)];

  // First sign-in on this account: adopt whatever this phone is already holding,
  // so absorbing a device's cards is a no-op rather than a data move that could
  // half-succeed. Nothing to hold on to means a brand new guest identity.
  if (!row) {
    const identity: AccountIdentity = device.memberId
      ? { kind: "member", id: device.memberId }
      : { kind: "guest", id: guestIds[0] ?? randomUUID() };
    const { error } = await supabaseAdmin.from("account_identities").insert({
      user_id: userId,
      participant_id: identity.kind === "member" ? identity.id : null,
      guest_id: identity.kind === "guest" ? identity.id : null,
    });
    if (!error) {
      for (const guestId of guestIds) await mergeGuestInto(identity, guestId);
      return mint(identity, identity.kind === "member" ? await nameFor(identity.id) : null);
    }
    // Another tab may have created this account between our read and insert.
    // Its row wins; fold this device into it rather than overwriting either id.
    if (error.code !== "23505") throw error;
    row = await readRow(userId);
    if (!row) throw error;
  }

  let identity = toIdentity(row);

  // The phone has since claimed a roster player: that is strictly more identity
  // than a guest id, so the account is upgraded and the guest's secrets ride along.
  if (identity.kind === "guest" && device.memberId) {
    const guestId = identity.id;
    // Guarded so a bindParticipant racing this call cannot be overwritten: only
    // a still-unbound row is upgraded, otherwise the winner's binding stands.
    const { data: upgraded, error } = await supabaseAdmin
      .from("account_identities")
      .update({ participant_id: device.memberId, guest_id: null })
      .eq("user_id", userId)
      .is("participant_id", null)
      .select("user_id, participant_id, guest_id");
    if (error) throw error;
    if (upgraded && upgraded.length > 0) {
      identity = { kind: "member", id: device.memberId };
      await mergeGuestInto(identity, guestId);
    } else {
      const winner = await readRow(userId);
      if (winner?.participant_id) {
        identity = { kind: "member", id: winner.participant_id };
        await mergeGuestInto(identity, guestId);
      }
    }
  }

  // A different guest id on this phone — pulls made here before signing in, or on
  // a second handset — is folded into the account's collection.
  for (const guestId of guestIds) await mergeGuestInto(identity, guestId);

  return mint(identity, identity.kind === "member" ? await nameFor(identity.id) : null);
}

/** Bind an account to a participant the device has just claimed with a paper code. */
export async function bindParticipant(userId: string, participantId: string) {
  const row = await readRow(userId);
  const priorGuest = row?.guest_id ?? null;

  // Re-claiming the same player is a no-op rather than an error: the phone may
  // simply have lost its local token and re-run the paper code.
  if (row?.participant_id === participantId) {
    return { kind: "member" as const, id: participantId, name: await nameFor(participantId) };
  }

  // A second, DIFFERENT roster player is refused instead of silently taking over.
  // syncAccount treats this row as authoritative, so an overwrite would re-mint
  // every other device onto the new player and strand the first identity with no
  // recovery path. Guest -> member is still an upgrade, handled below.
  if (row?.participant_id) {
    throw new Error("This account is already linked to another player");
  }

  // The read above is only a fast path — the write itself has to be the guard, or
  // two concurrent binds both pass the check and the last one silently wins.
  let bound = false;
  const { error: insertError } = await supabaseAdmin
    .from("account_identities")
    .insert({ user_id: userId, participant_id: participantId, guest_id: null });
  if (!insertError) {
    bound = true;
  } else if (insertError.code === "23505") {
    const { data: updated, error: updateError } = await supabaseAdmin
      .from("account_identities")
      .update({ participant_id: participantId, guest_id: null })
      .eq("user_id", userId)
      .is("participant_id", null)
      .select("user_id");
    if (updateError) throw updateError;
    bound = (updated?.length ?? 0) > 0;
  } else {
    throw insertError;
  }

  if (!bound) {
    const winner = await readRow(userId);
    if (winner?.participant_id !== participantId) {
      throw new Error("This account is already linked to another player");
    }
  }

  if (priorGuest) await mergeGuestInto({ kind: "member", id: participantId }, priorGuest);
  return { kind: "member" as const, id: participantId, name: await nameFor(participantId) };
}
