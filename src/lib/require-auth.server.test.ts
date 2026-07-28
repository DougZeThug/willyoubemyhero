// The guards themselves. Every mutating server function is supposed to open
// with one of these, and each runs against a genuine request header here rather
// than a stubbed one — so a token that would be accepted in production is
// accepted in the test, and nothing else is.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { signAdminToken, signMemberToken } from "./session.server";
import { isAdminFor, optionalMember, requireAdmin, requireMember } from "./require-auth.server";
import { adminHeaders, memberHeaders, withRequestHeaders } from "@/test/server-fn";

const EVENT_ID = "00000000-0000-4000-8000-0000000000ff";
const OTHER_EVENT_ID = "00000000-0000-4000-8000-0000000000ee";
const PARTICIPANT_ID = "00000000-0000-4000-8000-0000000000aa";

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-session-secret");
});

describe("requireAdmin", () => {
  it("throws when the request carries no token", async () => {
    await expect(withRequestHeaders({}, () => requireAdmin(EVENT_ID))).rejects.toThrow(
      "Admin PIN required",
    );
  });

  it("throws on a malformed token", async () => {
    await expect(
      withRequestHeaders(adminHeaders("garbage"), () => requireAdmin(EVENT_ID)),
    ).rejects.toThrow("Admin PIN required");
  });

  it("throws on a forged token", async () => {
    const forged = `${EVENT_ID}.${Date.now() + 60_000}.not-a-real-signature`;
    await expect(
      withRequestHeaders(adminHeaders(forged), () => requireAdmin(EVENT_ID)),
    ).rejects.toThrow("Admin PIN required");
  });

  it("accepts a valid token for the same event", async () => {
    const { token } = signAdminToken(EVENT_ID);
    await expect(
      withRequestHeaders(adminHeaders(token), () => requireAdmin(EVENT_ID)),
    ).resolves.toBeUndefined();
  });

  it("throws for a valid token issued for a different event", async () => {
    // Being the commissioner of last year's combine is not being the
    // commissioner of this one.
    const { token } = signAdminToken(OTHER_EVENT_ID);
    await expect(
      withRequestHeaders(adminHeaders(token), () => requireAdmin(EVENT_ID)),
    ).rejects.toThrow("Admin PIN required");
  });

  it("does not accept a member token", async () => {
    const { token } = signMemberToken(PARTICIPANT_ID);
    await expect(
      withRequestHeaders(adminHeaders(token), () => requireAdmin(EVENT_ID)),
    ).rejects.toThrow("Admin PIN required");
  });

  it("ignores a member token sent in the member header", async () => {
    const { token } = signMemberToken(PARTICIPANT_ID);
    await expect(
      withRequestHeaders(memberHeaders(token), () => requireAdmin(EVENT_ID)),
    ).rejects.toThrow("Admin PIN required");
  });
});

describe("requireMember", () => {
  it("throws when the request carries no token", async () => {
    await expect(withRequestHeaders({}, () => requireMember())).rejects.toThrow(
      "Claim your player first",
    );
  });

  it("returns the claimed participant id", async () => {
    const { token } = signMemberToken(PARTICIPANT_ID);
    await expect(withRequestHeaders(memberHeaders(token), () => requireMember())).resolves.toBe(
      PARTICIPANT_ID,
    );
  });

  it("does not accept an admin token", async () => {
    const { token } = signAdminToken(EVENT_ID);
    await expect(withRequestHeaders(memberHeaders(token), () => requireMember())).rejects.toThrow(
      "Claim your player first",
    );
  });

  it("throws on a forged token", async () => {
    const forged = `m.${PARTICIPANT_ID}.${Date.now() + 60_000}.not-a-real-signature`;
    await expect(withRequestHeaders(memberHeaders(forged), () => requireMember())).rejects.toThrow(
      "Claim your player first",
    );
  });
});

describe("optionalMember", () => {
  it("returns null instead of throwing when unauthenticated", async () => {
    await expect(withRequestHeaders({}, () => optionalMember())).resolves.toBeNull();
  });

  it("returns null for a forged token", async () => {
    const forged = `m.${PARTICIPANT_ID}.${Date.now() + 60_000}.nope`;
    await expect(
      withRequestHeaders(memberHeaders(forged), () => optionalMember()),
    ).resolves.toBeNull();
  });

  it("returns the participant id for a valid token", async () => {
    const { token } = signMemberToken(PARTICIPANT_ID);
    await expect(withRequestHeaders(memberHeaders(token), () => optionalMember())).resolves.toBe(
      PARTICIPANT_ID,
    );
  });
});

describe("isAdminFor", () => {
  it("is false without a token, and does not throw", async () => {
    await expect(withRequestHeaders({}, () => isAdminFor(EVENT_ID))).resolves.toBe(false);
  });

  it("is true for a matching event", async () => {
    const { token } = signAdminToken(EVENT_ID);
    await expect(withRequestHeaders(adminHeaders(token), () => isAdminFor(EVENT_ID))).resolves.toBe(
      true,
    );
  });

  it("is false for a different event", async () => {
    const { token } = signAdminToken(OTHER_EVENT_ID);
    await expect(withRequestHeaders(adminHeaders(token), () => isAdminFor(EVENT_ID))).resolves.toBe(
      false,
    );
  });
});
