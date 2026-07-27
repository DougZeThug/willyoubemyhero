// Shared guards for server functions. Every write in this app runs as
// service_role, so these are the only thing standing between a request and the
// database — call one as the first line of any mutating handler.
import { getRequestHeader } from "@tanstack/react-start/server";
import { verifyAdminToken, verifyMemberToken } from "./session.server";

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

export function isAdminFor(eventId: string): boolean {
  const claims = verifyAdminToken(getRequestHeader("x-admin-token") ?? null);
  return !!claims && claims.eventId === eventId;
}
