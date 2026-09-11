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
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { signGuestToken, signMemberToken } from "./session.server";

/**
 * The same client, widened, for the one RPC `types.ts` has not been regenerated
 * against yet.
 *
 * The escape hatch draft-db.server.ts and trades-rows.ts open, for the same
 * reason: src/integrations/supabase/types.ts is `supabase gen types` output,
 * must not be hand-edited, and is .prettierignore'd — so `bind_account_to_player`
 * (supabase/migrations/20260911140000_bind_account_in_one_transaction.sql) is a
 * compile error against the generated `Database` type. Regenerating types.ts
 * makes this a two-call-site removal.
 */
function untypedDb(): SupabaseClient {
  return supabaseAdmin as unknown as SupabaseClient;
}

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
    const { error: streakError } = await supabaseAdmin.rpc("claim_guest_streak_milestones", {
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
    const { error: streakError } = await supabaseAdmin.rpc("merge_guest_streak_milestones", {
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
  //
  // Same RPC as bindParticipant, and for the same reason: the upgrade and the
  // three moves that empty the guest id it is abandoning belong in one
  // transaction. The guest id is handed over explicitly because it was read
  // before this call — if a bind from another device won the race in between,
  // the row's own `guest_id` has already been cleared by the winner and this
  // collection would be stranded by the very write meant to rescue it. The RPC
  // files it against whoever the row belongs to, which is exactly what the two
  // branches this replaces both did.
  if (identity.kind === "guest" && device.memberId) {
    const { data, error } = await untypedDb().rpc("bind_account_to_player", {
      _user_id: userId,
      _participant_id: device.memberId,
      _guest_id: identity.id,
    });
    if (error) throw error;
    const res = (data ?? {}) as { boundParticipantId?: string | null };
    if (res.boundParticipantId) identity = { kind: "member", id: res.boundParticipantId };
  }

  // A different guest id on this phone — pulls made here before signing in, or on
  // a second handset — is folded into the account's collection.
  for (const guestId of guestIds) await mergeGuestInto(identity, guestId);

  return mint(identity, identity.kind === "member" ? await nameFor(identity.id) : null);
}

/**
 * The account is already spoken for by somebody else.
 *
 * A named class rather than a bare Error, because the caller has to tell this
 * apart from a flaky request: the claim screen swallowed both in one `catch {}`
 * and said "Welcome" either way, so the next phone to sign in got the OLD player
 * back with nothing anywhere having said the link was refused.
 */
export class AccountAlreadyLinkedError extends Error {
  readonly reason = "already_linked" as const;
  constructor(readonly boundName: string | null) {
    super("This account is already linked to another player");
    this.name = "AccountAlreadyLinkedError";
  }
}

/**
 * Bind an account to a participant the device has just claimed with a paper code.
 *
 * One statement, because the row and the collection it claims to own have to
 * move together. This used to be an insert-or-update followed by the three
 * `claim_guest_*` calls, each its own request and its own transaction: a failure
 * partway left the account bound to the player with some of its old guest
 * collection still filed under the dead guest id, and no rollback of the row
 * write that had already committed. The shape `attach_device_to_player` was
 * written to retire, still standing on the path a player actually walks.
 *
 * Re-claiming the same player stays a no-op rather than an error — the phone may
 * simply have lost its token and re-run the code — and a second, DIFFERENT
 * roster player is still refused rather than taken over. Both live in the RPC
 * now, where they can be decided under the row's own lock.
 */
export async function bindParticipant(userId: string, participantId: string) {
  const { data, error } = await untypedDb().rpc("bind_account_to_player", {
    _user_id: userId,
    _participant_id: participantId,
  });
  if (error) throw error;
  const res = (data ?? {}) as { bound?: boolean; name?: string | null; boundName?: string | null };
  if (!res.bound) throw new AccountAlreadyLinkedError(res.boundName ?? null);
  return { kind: "member" as const, id: participantId, name: res.name ?? null };
}
