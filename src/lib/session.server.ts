import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export function hashPin(salt: string, pin: string): string {
  return createHash("sha256").update(`${salt}::${pin}`).digest("hex");
}

export function timingSafeEq(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12h

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function sign(payload: string, secret: string): string {
  return b64url(createHmac("sha256", secret).update(payload).digest());
}

export function signAdminToken(eventId: string): { token: string; expiresAt: number } {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const payload = `${eventId}.${expiresAt}`;
  const sig = sign(payload, secret);
  return { token: `${payload}.${sig}`, expiresAt };
}

export function verifyAdminToken(
  token: string | null | undefined,
): { eventId: string; expiresAt: number } | null {
  if (!token) return null;
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [eventId, expStr, sig] = parts;
  const expiresAt = Number(expStr);
  if (!eventId || !Number.isFinite(expiresAt)) return null;
  const expected = sign(`${eventId}.${expiresAt}`, secret);
  if (!timingSafeEq(sig, expected)) return null;
  if (Date.now() > expiresAt) return null;
  return { eventId, expiresAt };
}

// ---------- League member sessions ----------
//
// Same HMAC construction as the admin token, but a distinct 4-part shape with an
// "m" prefix that is also inside the signed payload. An admin token can never be
// parsed as a member token (3 parts vs 4) and a signature cannot be transplanted
// between the two, because the prefix is part of what gets signed.

const MEMBER_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days — this is a party app
const MEMBER_PREFIX = "m";

export function hashCode(salt: string, code: string): string {
  // Codes are handed out on paper; compare case-insensitively.
  return createHash("sha256").update(`${salt}::${code.trim().toUpperCase()}`).digest("hex");
}

export function signMemberToken(participantId: string): { token: string; expiresAt: number } {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  const expiresAt = Date.now() + MEMBER_TOKEN_TTL_MS;
  const payload = `${MEMBER_PREFIX}.${participantId}.${expiresAt}`;
  return { token: `${payload}.${sign(payload, secret)}`, expiresAt };
}

export function verifyMemberToken(
  token: string | null | undefined,
): { participantId: string; expiresAt: number } | null {
  if (!token) return null;
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [prefix, participantId, expStr, sig] = parts;
  if (prefix !== MEMBER_PREFIX) return null;
  const expiresAt = Number(expStr);
  if (!participantId || !Number.isFinite(expiresAt)) return null;
  const expected = sign(`${MEMBER_PREFIX}.${participantId}.${expiresAt}`, secret);
  if (!timingSafeEq(sig, expected)) return null;
  if (Date.now() > expiresAt) return null;
  return { participantId, expiresAt };
}
