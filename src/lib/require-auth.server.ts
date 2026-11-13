// Shared guards for server functions. Every write in this app runs as
// service_role, so these are the only thing standing between a request and the
// database — call one as the first line of any mutating handler.
import { getRequestHeader } from "@tanstack/react-start/server";
import { sqlNull } from "./rpc-null";
import { verifyAdminToken, verifyGuestToken, verifyMemberToken } from "./session.server";
import { TOKEN_HEADERS } from "./token-format";

export async function requireAdmin(eventId: string): Promise<void> {
  if (!(await isAdminFor(eventId))) throw new Error("Admin PIN required");
}

/**
 * Whether this account is still on the admin list. Throws when the lookup
 * fails: an outage must not read as "still an admin" (fail closed).
 */
async function accountStillAdmin(userId: string): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("admin_accounts")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error("Could not confirm admin access");
  return data !== null;
}

/** Resolves to the claimed participant id, or throws. */
export async function requireMember(): Promise<string> {
  return (await requireMemberSession()).participantId;
}

/**
 * The verified member token's expiry as well as its participant. For the one
 * handler that has to reason about the token itself: renewal.
 */
export async function requireMemberSession(): Promise<{
  participantId: string;
  expiresAt: number;
}> {
  const claims = verifyMemberToken(getRequestHeader(TOKEN_HEADERS.member) ?? null);
  if (!claims) {
    throw new Error("Claim your player first");
  }
  return claims;
}

/** Member id when one is present, otherwise null. For read paths that personalise. */
export function optionalMember(): string | null {
  return verifyMemberToken(getRequestHeader(TOKEN_HEADERS.member) ?? null)?.participantId ?? null;
}

/** Server-minted guest id when this device holds one, otherwise null. */
export function optionalGuest(): string | null {
  return verifyGuestToken(getRequestHeader(TOKEN_HEADERS.guest) ?? null)?.guestId ?? null;
}

/** A signed identity saved immediately before authentication started. */
export function optionalAccountHandoff(): Actor | null {
  const token = getRequestHeader(TOKEN_HEADERS.accountHandoff) ?? null;
  const member = verifyMemberToken(token);
  if (member) return { kind: "member", id: member.participantId };
  const guest = verifyGuestToken(token);
  return guest ? { kind: "guest", id: guest.guestId } : null;
}

/**
 * Whoever is asking, member or guest.
 *
 * For the paths a guest is allowed to take — the daily secret card and its
 * status. A member always wins over a guest token on the same device: somebody
 * who played as a guest and then claimed a player must not end up with their
 * history split across two identities, and `claimPlayer` moves the guest's pulls
 * onto the participant precisely so that never happens.
 */
export type Actor = { kind: "member"; id: string } | { kind: "guest"; id: string };

export function optionalActor(): Actor | null {
  const member = optionalMember();
  if (member) return { kind: "member", id: member };
  const guest = optionalGuest();
  return guest ? { kind: "guest", id: guest } : null;
}

/**
 * Resolves to whoever is asking, or throws when the device holds no token at all.
 *
 * The default message is requireMember's: a device with no identity of either
 * kind is one that has never been through the pack screen, and "claim your
 * player" is still the useful thing to tell them. Social overrides it because a
 * guest there can join in just by typing a name.
 */
export function requireActor(message = "Claim your player first"): Actor {
  const actor = optionalActor();
  if (!actor) throw new Error(message);
  return actor;
}

/**
 * Whether the request carries an admin token for this event. Re-checks the admin
 * list for account tokens: a revoked account's token stays signed until it
 * expires, and a token minted from an account is only as good as that account's
 * place on the list now. PIN tokens name no account and are unaffected.
 */
export async function isAdminFor(eventId: string): Promise<boolean> {
  const claims = verifyAdminToken(getRequestHeader(TOKEN_HEADERS.admin) ?? null);
  if (!claims || claims.eventId !== eventId) return false;
  if (claims.userId) return await accountStillAdmin(claims.userId);
  return true;
}

/** The column that holds this actor's id on the per-device tables. */
export function actorColumn(actor: Actor): "participant_id" | "guest_id" {
  return actor.kind === "member" ? "participant_id" : "guest_id";
}

/** The `_participant_id` / `_guest_id` pair every actor-scoped RPC takes; one side is null. */
export function actorRpcArgs(actor: Actor) {
  return {
    _participant_id: sqlNull(actor.kind === "member" ? actor.id : null),
    _guest_id: sqlNull(actor.kind === "guest" ? actor.id : null),
  };
}

/**
 * Every identity this device can speak for during sign-in: the verified member
 * and guest tokens plus whatever was handed off from before authentication
 * started. What `syncAccount` and `createCollector` adopt into the account.
 */
export function deviceIdentity(): { memberId: string | null; guestIds: string[] } {
  const handoff = optionalAccountHandoff();
  return {
    memberId: optionalMember() ?? (handoff?.kind === "member" ? handoff.id : null),
    guestIds: [optionalGuest(), handoff?.kind === "guest" ? handoff.id : null].filter(
      (id): id is string => Boolean(id),
    ),
  };
}
