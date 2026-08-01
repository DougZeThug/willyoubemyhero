// The guards themselves. Every mutating server function is supposed to open
// with one of these, and each runs against a genuine request header here rather
// than a stubbed one — so a token that would be accepted in production is
// accepted in the test, and nothing else is.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { signAdminToken, signGuestToken, signMemberToken } from "./session.server";
import {
  isAdminFor,
  optionalGuest,
  optionalMember,
  requireActor,
  requireAdmin,
  requireMember,
} from "./require-auth.server";
import { adminHeaders, guestHeaders, memberHeaders, withRequestHeaders } from "@/test/server-fn";

const EVENT_ID = "00000000-0000-4000-8000-0000000000ff";
const OTHER_EVENT_ID = "00000000-0000-4000-8000-0000000000ee";
const PARTICIPANT_ID = "00000000-0000-4000-8000-0000000000aa";
const GUEST_ID = "00000000-0000-4000-8000-0000000000e1";

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

describe("optionalGuest", () => {
  it("returns null instead of throwing when there is no guest token", async () => {
    await expect(withRequestHeaders({}, () => optionalGuest())).resolves.toBeNull();
  });

  it("returns null for a forged token", async () => {
    const forged = `g.${GUEST_ID}.${Date.now() + 60_000}.nope`;
    await expect(
      withRequestHeaders(guestHeaders(forged), () => optionalGuest()),
    ).resolves.toBeNull();
  });

  it("returns the guest id for a valid token", async () => {
    const { token } = signGuestToken(GUEST_ID);
    await expect(withRequestHeaders(guestHeaders(token), () => optionalGuest())).resolves.toBe(
      GUEST_ID,
    );
  });

  it("does not accept a member token in the guest header", async () => {
    // Both schemes are four parts; only the signed prefix separates them.
    const { token } = signMemberToken(PARTICIPANT_ID);
    await expect(
      withRequestHeaders(guestHeaders(token), () => optionalGuest()),
    ).resolves.toBeNull();
  });
});

describe("requireActor", () => {
  it("throws when the device holds no token of either kind", async () => {
    await expect(withRequestHeaders({}, () => requireActor())).rejects.toThrow(
      "Claim your player first",
    );
  });

  it("resolves a member", async () => {
    const { token } = signMemberToken(PARTICIPANT_ID);
    await expect(withRequestHeaders(memberHeaders(token), () => requireActor())).resolves.toEqual({
      kind: "member",
      id: PARTICIPANT_ID,
    });
  });

  it("resolves a guest", async () => {
    const { token } = signGuestToken(GUEST_ID);
    await expect(withRequestHeaders(guestHeaders(token), () => requireActor())).resolves.toEqual({
      kind: "guest",
      id: GUEST_ID,
    });
  });

  it("prefers the member when the device carries both", async () => {
    // A guest who claims a player keeps their guest token. Their pulls were
    // merged onto the participant at claim time, so the member is the identity
    // that owns them — resolving the guest here would strand the collection.
    const member = signMemberToken(PARTICIPANT_ID).token;
    const guest = signGuestToken(GUEST_ID).token;
    await expect(
      withRequestHeaders({ ...memberHeaders(member), ...guestHeaders(guest) }, () =>
        requireActor(),
      ),
    ).resolves.toEqual({ kind: "member", id: PARTICIPANT_ID });
  });

  it("is not satisfied by an admin token", async () => {
    const { token } = signAdminToken(EVENT_ID);
    await expect(withRequestHeaders(adminHeaders(token), () => requireActor())).rejects.toThrow(
      "Claim your player first",
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
