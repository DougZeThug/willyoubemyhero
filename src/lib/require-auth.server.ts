// Shared guards for server functions. Every write in this app runs as
// service_role, so these are the only thing standing between a request and the
// database — call one as the first line of any mutating handler.
import { getRequestHeader } from "@tanstack/react-start/server";
import { verifyAdminToken, verifyGuestToken, verifyMemberToken } from "./session.server";

export async function requireAdmin(eventId: string) {
  const claims = verifyAdminToken(getRequestHeader("x-admin-token") ?? null);
  if (!claims || claims.eventId !== eventId) {
    throw new Error("Admin PIN required");
  }
}

/** Resolves to the claimed participant id, or throws. */
export async function requireMember(): Promise<string> {
  const claims = verifyMemberToken(getRequestHeader("x-member-token") ?? null);
  if (!claims) {
    throw new Error("Claim your player first");
  }
  return claims.participantId;
}

/** Member id when one is present, otherwise null. For read paths that personalise. */
export function optionalMember(): string | null {
  return verifyMemberToken(getRequestHeader("x-member-token") ?? null)?.participantId ?? null;
}

/** Server-minted guest id when this device holds one, otherwise null. */
export function optionalGuest(): string | null {
  return verifyGuestToken(getRequestHeader("x-guest-token") ?? null)?.guestId ?? null;
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

/** Resolves to whoever is asking, or throws when the device holds no token at all. */
export function requireActor(): Actor {
  const actor = optionalActor();
  // Same message as requireMember: a device with no identity of either kind is
  // one that has never been through the pack screen, and "claim your player" is
  // still the useful thing to tell them.
  if (!actor) throw new Error("Claim your player first");
  return actor;
}

export function isAdminFor(eventId: string): boolean {
  const claims = verifyAdminToken(getRequestHeader("x-admin-token") ?? null);
  return !!claims && claims.eventId === eventId;
}
