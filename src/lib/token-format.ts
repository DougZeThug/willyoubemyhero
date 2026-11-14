// The wire shape of the three signed tokens, in one place so the server that
// signs them and the device that reads them cannot drift apart. Client-safe: no
// secrets and no crypto, only how a token string is cut up. session.server.ts
// does the signing and verifying; the *-token.ts stores use this to read expiry.
//
//   admin (PIN)      <eventId>.<expiresAt>.<sig>                   3 parts
//   admin (account)  a.<userId>.<eventId>.<expiresAt>.<sig>        5 parts
//   member           m.<participantId>.<expiresAt>.<sig>           4 parts
//   guest            g.<guestId>.<expiresAt>.<sig>                 4 parts
//
// The prefix sits INSIDE the signed payload, which is what stops a signature
// being transplanted between schemes. Member and guest are both four parts, so
// the prefix is the only thing telling them apart.

export const ACCOUNT_ADMIN_PREFIX = "a";
export const MEMBER_PREFIX = "m";
export const GUEST_PREFIX = "g";

/** Request headers the device attaches and the server reads. */
export const TOKEN_HEADERS = {
  admin: "x-admin-token",
  member: "x-member-token",
  guest: "x-guest-token",
  accountHandoff: "x-account-handoff-token",
} as const;

export type ParsedToken = {
  /** Participant id, guest id or event id: whatever the token names. */
  id: string;
  expiresAt: number;
  sig: string;
  /** What the signature covers, rebuilt from the parsed parts. */
  payload: string;
};

/** A member or guest token: `<prefix>.<id>.<expiresAt>.<sig>`. Expiry is not checked. */
export function parsePrefixedToken(prefix: string, token: string): ParsedToken | null {
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [tokenPrefix, id, expStr, sig] = parts;
  if (tokenPrefix !== prefix) return null;
  const expiresAt = Number(expStr);
  if (!id || !Number.isFinite(expiresAt)) return null;
  return { id, expiresAt, sig, payload: `${prefix}.${id}.${expiresAt}` };
}

export type ParsedAdminToken = ParsedToken & { userId?: string };

/** An admin token, PIN (3 parts) or account (5 parts). Expiry is not checked. */
export function parseAdminToken(token: string): ParsedAdminToken | null {
  const parts = token.split(".");
  if (parts.length === 5) {
    const [prefix, userId, eventId, expStr, sig] = parts;
    if (prefix !== ACCOUNT_ADMIN_PREFIX || !userId || !eventId) return null;
    const expiresAt = Number(expStr);
    if (!Number.isFinite(expiresAt)) return null;
    return {
      id: eventId,
      userId,
      expiresAt,
      sig,
      payload: `${ACCOUNT_ADMIN_PREFIX}.${userId}.${eventId}.${expiresAt}`,
    };
  }
  if (parts.length !== 3) return null;
  const [eventId, expStr, sig] = parts;
  const expiresAt = Number(expStr);
  if (!eventId || !Number.isFinite(expiresAt)) return null;
  return { id: eventId, expiresAt, sig, payload: `${eventId}.${expiresAt}` };
}
