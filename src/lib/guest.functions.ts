import { createServerFn } from "@tanstack/react-start";
import { randomUUID } from "node:crypto";
import { optionalGuest } from "./require-auth.server";
import { signGuestToken } from "./session.server";

/**
 * Hand this device an anonymous identity, so a guest can own a secret card.
 *
 * Takes no input, and that is the entire security design. The id is minted here
 * and never accepted from the caller: a handler that signed whatever id it was
 * given would let anybody mint a token for somebody else's guest id and spend
 * their daily pull, which is precisely what signing the token is meant to prevent.
 *
 * Returns the existing session when the device already holds a valid one, so a
 * double call — two tabs, a remount, a retry — cannot orphan yesterday's identity
 * and with it the secrets attached to it.
 *
 * Known and accepted: clearing site data drops the token, and the next call mints
 * a fresh id with a fresh daily pull. Nothing server-side can tell that apart from
 * a genuinely new phone. See the note in the guest_id migration.
 */
export const startGuestSession = createServerFn({ method: "POST" }).handler(
  async (): Promise<{
    ok: true;
    guestId: string;
    /** Null when the device already had a valid token — there is nothing to store. */
    token: string | null;
    expiresAt: number | null;
  }> => {
    const existing = optionalGuest();
    if (existing) return { ok: true, guestId: existing, token: null, expiresAt: null };

    const guestId = randomUUID();
    const { token, expiresAt } = signGuestToken(guestId);
    return { ok: true, guestId, token, expiresAt };
  },
);
