// Minting an anonymous identity.
//
// One property matters here: the guest id is generated on the server and never
// taken from the caller. A handler that signed whatever id it was handed would
// let anyone mint a token for somebody else's guest id and spend their daily
// pull, which is the exact attack signing the token is meant to prevent.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { callServerFn, guestHeaders } from "@/test/server-fn";
import { signGuestToken, verifyGuestToken, verifyMemberToken } from "./session.server";

const EXISTING = "00000000-0000-4000-8000-0000000000e1";
const THEIRS = "00000000-0000-4000-8000-0000000000e2";

type Session = { ok: true; guestId: string; token: string | null; expiresAt: number | null };

async function start(data?: unknown, headers?: Record<string, string>) {
  const { startGuestSession } = await import("./guest.functions");
  return callServerFn<Session>(startGuestSession, { data, headers });
}

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-session-secret");
});

describe("startGuestSession", () => {
  it("mints a signed token for a device with no identity", async () => {
    const res = await start();
    expect(res.token).toBeTruthy();
    expect(verifyGuestToken(res.token)?.guestId).toBe(res.guestId);
  });

  it("ignores a guest id in the payload entirely", async () => {
    // The attack this endpoint exists to be immune to.
    const res = await start({ guestId: THEIRS });
    expect(res.guestId).not.toBe(THEIRS);
    expect(verifyGuestToken(res.token)?.guestId).not.toBe(THEIRS);
  });

  it("gives two callers two different identities", async () => {
    const [a, b] = [await start(), await start()];
    expect(a.guestId).not.toBe(b.guestId);
  });

  it("returns the existing identity rather than minting a second one", async () => {
    // A double call — two tabs, a remount, a retry — must not orphan yesterday's
    // id and the secrets attached to it.
    const res = await start(undefined, guestHeaders(signGuestToken(EXISTING).token));
    expect(res.guestId).toBe(EXISTING);
    expect(res.token).toBeNull();
  });

  it("ignores a guest token it did not sign", async () => {
    const res = await start(undefined, guestHeaders(`g.${THEIRS}.${Date.now() + 60_000}.forged`));
    expect(res.guestId).not.toBe(THEIRS);
    expect(res.token).toBeTruthy();
  });

  it("does not issue anything that verifies as a member token", async () => {
    // Both schemes are four parts; only the signed prefix separates them.
    const res = await start();
    expect(verifyMemberToken(res.token)).toBeNull();
  });
});
