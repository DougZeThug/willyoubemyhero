// Token signing and verification.
//
// Every write in this app runs as service_role, so these two functions are the
// entire authorization boundary. A regression here is not a broken feature, it
// is an open admin console.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  hashCode,
  hashPin,
  signAdminToken,
  signGuestToken,
  signMemberToken,
  timingSafeEq,
  verifyAdminToken,
  verifyGuestToken,
  verifyMemberToken,
} from "./session.server";

const EVENT_ID = "00000000-0000-4000-8000-0000000000ff";
const PARTICIPANT_ID = "00000000-0000-4000-8000-0000000000aa";
const GUEST_ID = "00000000-0000-4000-8000-0000000000e1";

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-session-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("hashPin", () => {
  it("is deterministic for the same salt and pin", () => {
    expect(hashPin("salt", "1234")).toBe(hashPin("salt", "1234"));
  });

  it("changes with the salt", () => {
    expect(hashPin("salt-a", "1234")).not.toBe(hashPin("salt-b", "1234"));
  });

  it("changes with the pin", () => {
    expect(hashPin("salt", "1234")).not.toBe(hashPin("salt", "1235"));
  });

  it("does not normalise the pin — a PIN is typed, not read off paper", () => {
    expect(hashPin("salt", " 1234")).not.toBe(hashPin("salt", "1234"));
  });
});

describe("hashCode", () => {
  it("ignores case and surrounding whitespace", () => {
    const canonical = hashCode("salt", "ACDEF4");
    expect(hashCode("salt", "acdef4")).toBe(canonical);
    expect(hashCode("salt", "  AcDeF4  ")).toBe(canonical);
  });

  it("still distinguishes different codes", () => {
    expect(hashCode("salt", "ACDEF4")).not.toBe(hashCode("salt", "ACDEF6"));
  });
});

describe("timingSafeEq", () => {
  it("matches identical strings", () => {
    expect(timingSafeEq("abc", "abc")).toBe(true);
  });

  it("rejects different strings of equal length", () => {
    expect(timingSafeEq("abc", "abd")).toBe(false);
  });

  it("returns false rather than throwing on a length mismatch", () => {
    // node:crypto's timingSafeEqual throws when the buffers differ in length,
    // so the length guard has to come first.
    expect(() => timingSafeEq("abc", "abcdef")).not.toThrow();
    expect(timingSafeEq("abc", "abcdef")).toBe(false);
    expect(timingSafeEq("", "a")).toBe(false);
  });
});

describe("admin tokens", () => {
  it("round-trips the event id", () => {
    const { token, expiresAt } = signAdminToken(EVENT_ID);
    const claims = verifyAdminToken(token);
    expect(claims).toEqual({ eventId: EVENT_ID, expiresAt });
  });

  it("issues a 12 hour token", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T12:00:00Z"));
    const { expiresAt } = signAdminToken(EVENT_ID);
    expect(expiresAt - Date.now()).toBe(12 * 60 * 60 * 1000);
  });

  it("rejects null, undefined and empty input", () => {
    expect(verifyAdminToken(null)).toBeNull();
    expect(verifyAdminToken(undefined)).toBeNull();
    expect(verifyAdminToken("")).toBeNull();
  });

  it("rejects a token with the wrong number of segments", () => {
    expect(verifyAdminToken("only.two")).toBeNull();
    expect(verifyAdminToken("a.b.c.d")).toBeNull();
  });

  it("rejects a tampered signature", () => {
    const { token } = signAdminToken(EVENT_ID);
    const [eventId, exp, sig] = token.split(".");
    const flipped = sig[0] === "A" ? `B${sig.slice(1)}` : `A${sig.slice(1)}`;
    expect(verifyAdminToken(`${eventId}.${exp}.${flipped}`)).toBeNull();
  });

  it("rejects a token whose event id was swapped", () => {
    const { token } = signAdminToken(EVENT_ID);
    const [, exp, sig] = token.split(".");
    expect(verifyAdminToken(`00000000-0000-4000-8000-000000000bad.${exp}.${sig}`)).toBeNull();
  });

  it("rejects an extended expiry", () => {
    // The most obvious attack: keep the signature, push the deadline out.
    const { token, expiresAt } = signAdminToken(EVENT_ID);
    const [eventId, , sig] = token.split(".");
    expect(verifyAdminToken(`${eventId}.${expiresAt + 60_000}.${sig}`)).toBeNull();
  });

  it("rejects a non-numeric expiry", () => {
    const { token } = signAdminToken(EVENT_ID);
    const [eventId, , sig] = token.split(".");
    expect(verifyAdminToken(`${eventId}.soon.${sig}`)).toBeNull();
  });

  it("rejects an expired token", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T12:00:00Z"));
    const { token } = signAdminToken(EVENT_ID);
    expect(verifyAdminToken(token)).not.toBeNull();

    vi.setSystemTime(new Date("2026-07-29T12:00:01Z"));
    expect(verifyAdminToken(token)).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const { token } = signAdminToken(EVENT_ID);
    vi.stubEnv("SESSION_SECRET", "a-different-secret");
    expect(verifyAdminToken(token)).toBeNull();
  });

  it("throws when SESSION_SECRET is unset rather than signing with undefined", () => {
    vi.stubEnv("SESSION_SECRET", "");
    expect(() => signAdminToken(EVENT_ID)).toThrow(/SESSION_SECRET/);
  });

  it("verifies nothing when SESSION_SECRET is unset", () => {
    const { token } = signAdminToken(EVENT_ID);
    vi.stubEnv("SESSION_SECRET", "");
    expect(verifyAdminToken(token)).toBeNull();
  });
});

describe("member tokens", () => {
  it("round-trips the participant id", () => {
    const { token, expiresAt } = signMemberToken(PARTICIPANT_ID);
    expect(verifyMemberToken(token)).toEqual({ participantId: PARTICIPANT_ID, expiresAt });
  });

  it("issues a 90 day token", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T12:00:00Z"));
    const { expiresAt } = signMemberToken(PARTICIPANT_ID);
    expect(expiresAt - Date.now()).toBe(90 * 24 * 60 * 60 * 1000);
  });

  it("rejects a tampered participant id", () => {
    const { token } = signMemberToken(PARTICIPANT_ID);
    const [prefix, , exp, sig] = token.split(".");
    expect(
      verifyMemberToken(`${prefix}.00000000-0000-4000-8000-000000000bad.${exp}.${sig}`),
    ).toBeNull();
  });

  it("rejects an extended expiry", () => {
    const { token, expiresAt } = signMemberToken(PARTICIPANT_ID);
    const [prefix, pid, , sig] = token.split(".");
    expect(verifyMemberToken(`${prefix}.${pid}.${expiresAt + 60_000}.${sig}`)).toBeNull();
  });

  it("rejects a wrong prefix even when the rest is intact", () => {
    const { token } = signMemberToken(PARTICIPANT_ID);
    const [, pid, exp, sig] = token.split(".");
    expect(verifyMemberToken(`x.${pid}.${exp}.${sig}`)).toBeNull();
  });

  it("rejects an expired token", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T12:00:00Z"));
    const { token } = signMemberToken(PARTICIPANT_ID);
    vi.setSystemTime(new Date("2026-11-01T12:00:00Z"));
    expect(verifyMemberToken(token)).toBeNull();
  });
});

describe("guest tokens", () => {
  it("round-trips the guest id", () => {
    const { token } = signGuestToken(GUEST_ID);
    expect(verifyGuestToken(token)?.guestId).toBe(GUEST_ID);
  });

  it("issues a 90 day token", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T12:00:00Z"));
    const { expiresAt } = signGuestToken(GUEST_ID);
    expect(expiresAt).toBe(Date.parse("2026-10-30T12:00:00Z"));
  });

  it("rejects a tampered guest id", () => {
    const { token } = signGuestToken(GUEST_ID);
    const [prefix, , exp, sig] = token.split(".");
    expect(verifyGuestToken(`${prefix}.${PARTICIPANT_ID}.${exp}.${sig}`)).toBeNull();
  });

  it("rejects an extended expiry", () => {
    const { token } = signGuestToken(GUEST_ID);
    const [prefix, gid, , sig] = token.split(".");
    expect(verifyGuestToken(`${prefix}.${gid}.${Date.now() + 999_999_999}.${sig}`)).toBeNull();
  });

  it("rejects a wrong prefix even when the rest is intact", () => {
    const { token } = signGuestToken(GUEST_ID);
    const [, gid, exp, sig] = token.split(".");
    expect(verifyGuestToken(`x.${gid}.${exp}.${sig}`)).toBeNull();
  });

  it("rejects an expired token", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T12:00:00Z"));
    const { token } = signGuestToken(GUEST_ID);
    vi.setSystemTime(new Date("2026-12-01T12:00:00Z"));
    expect(verifyGuestToken(token)).toBeNull();
  });

  it("throws when SESSION_SECRET is unset rather than signing with undefined", () => {
    vi.stubEnv("SESSION_SECRET", "");
    expect(() => signGuestToken(GUEST_ID)).toThrow();
  });
});

describe("the three token types cannot be interchanged", () => {
  // The prefix is inside the signed payload precisely so a signature cannot be
  // transplanted between the schemes. Nothing else pins that down — and it matters
  // most for the member/guest pair, which are both four parts and differ in
  // nothing but that prefix.
  it("an admin token does not verify as a member token", () => {
    const { token } = signAdminToken(EVENT_ID);
    expect(verifyMemberToken(token)).toBeNull();
  });

  it("a member token does not verify as an admin token", () => {
    const { token } = signMemberToken(PARTICIPANT_ID);
    expect(verifyAdminToken(token)).toBeNull();
  });

  it("an admin signature cannot be replayed inside a member token envelope", () => {
    // Same id, same expiry, admin's signature, member's 4-part shape.
    const { token, expiresAt } = signAdminToken(PARTICIPANT_ID);
    const sig = token.split(".")[2];
    expect(verifyMemberToken(`m.${PARTICIPANT_ID}.${expiresAt}.${sig}`)).toBeNull();
  });

  it("a member signature cannot be replayed inside an admin token envelope", () => {
    const { token, expiresAt } = signMemberToken(EVENT_ID);
    const sig = token.split(".")[3];
    expect(verifyAdminToken(`${EVENT_ID}.${expiresAt}.${sig}`)).toBeNull();
  });

  it("a member token does not verify as a guest token", () => {
    const { token } = signMemberToken(PARTICIPANT_ID);
    expect(verifyGuestToken(token)).toBeNull();
  });

  it("a guest token does not verify as a member token", () => {
    // The one that would matter most: a guest promoting themselves to a claimed
    // player would inherit that player's whole identity, not just a card.
    const { token } = signGuestToken(GUEST_ID);
    expect(verifyMemberToken(token)).toBeNull();
  });

  it("a guest signature cannot be replayed inside a member token envelope", () => {
    // Identical shape, identical id, identical expiry — only the signed prefix
    // differs, which is exactly the transplant the prefix exists to stop.
    const { token, expiresAt } = signGuestToken(PARTICIPANT_ID);
    const sig = token.split(".")[3];
    expect(verifyMemberToken(`m.${PARTICIPANT_ID}.${expiresAt}.${sig}`)).toBeNull();
  });

  it("a member signature cannot be replayed inside a guest token envelope", () => {
    const { token, expiresAt } = signMemberToken(GUEST_ID);
    const sig = token.split(".")[3];
    expect(verifyGuestToken(`g.${GUEST_ID}.${expiresAt}.${sig}`)).toBeNull();
  });

  it("a guest token does not verify as an admin token", () => {
    const { token } = signGuestToken(GUEST_ID);
    expect(verifyAdminToken(token)).toBeNull();
  });
});
