// Renewing a member token inside its last month, client side.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renewMemberTokenIfDue, RENEW_WITHIN_MS, type Renew } from "./member-renewal";

const KEY = "wwbh:member-token";
const NAME_KEY = "wwbh:member-name";
const PARTICIPANT_ID = "00000000-0000-4000-8000-0000000000aa";
const OTHER_ID = "00000000-0000-4000-8000-0000000000bb";
const DAY = 24 * 60 * 60 * 1000;

const tokenFor = (expiresAt: number, id = PARTICIPANT_ID) => `m.${id}.${expiresAt}.signature`;

function store(token: string, name = "Doug") {
  window.localStorage.setItem(KEY, token);
  window.localStorage.setItem(NAME_KEY, name);
}

function renewing(token: string): Renew & ReturnType<typeof vi.fn> {
  return vi.fn(() =>
    Promise.resolve({ ok: true as const, token, expiresAt: Number(token.split(".")[2]) }),
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("renewMemberTokenIfDue", () => {
  it("renews a token with under thirty days left, once, and stores the new one", async () => {
    store(tokenFor(Date.now() + 10 * DAY));
    const fresh = tokenFor(Date.now() + 90 * DAY);
    const renew = renewing(fresh);

    expect(await renewMemberTokenIfDue(renew)).toBe(true);
    expect(renew).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(KEY)).toBe(fresh);
    // The cached name rides along untouched: a renewal is not a new identity.
    expect(window.localStorage.getItem(NAME_KEY)).toBe("Doug");
  });

  it("asks once when the mount and a tick land together", async () => {
    store(tokenFor(Date.now() + 10 * DAY));
    let resolve!: (v: { ok: true; token: string; expiresAt: number }) => void;
    const renew = vi.fn(
      () => new Promise<{ ok: true; token: string; expiresAt: number }>((r) => (resolve = r)),
    );
    const a = renewMemberTokenIfDue(renew);
    const b = renewMemberTokenIfDue(renew);
    const fresh = tokenFor(Date.now() + 90 * DAY);
    resolve({ ok: true, token: fresh, expiresAt: Date.now() + 90 * DAY });
    expect(await a).toBe(true);
    expect(await b).toBe(true);
    expect(renew).toHaveBeenCalledTimes(1);
  });

  it("leaves a token with more than thirty days left alone", async () => {
    const token = tokenFor(Date.now() + RENEW_WITHIN_MS + DAY);
    store(token);
    const renew = renewing(tokenFor(Date.now() + 90 * DAY));
    expect(await renewMemberTokenIfDue(renew)).toBe(false);
    expect(renew).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(KEY)).toBe(token);
  });

  it("never sends an absent or expired token", async () => {
    const renew = renewing(tokenFor(Date.now() + 90 * DAY));
    expect(await renewMemberTokenIfDue(renew)).toBe(false);
    store(tokenFor(Date.now() - 1));
    expect(await renewMemberTokenIfDue(renew)).toBe(false);
    expect(renew).not.toHaveBeenCalled();
  });

  it("keeps the old token when the request fails, and does not retry on its own", async () => {
    const token = tokenFor(Date.now() + 10 * DAY);
    store(token);
    const renew = vi.fn(() => Promise.reject(new Error("offline")));
    expect(await renewMemberTokenIfDue(renew)).toBe(false);
    expect(renew).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(KEY)).toBe(token);
    expect(window.localStorage.getItem(NAME_KEY)).toBe("Doug");
  });

  it("keeps the old token when the server refuses a renewal across a code rotation", async () => {
    // The token keeps working until it runs out, exactly as a rotation promises;
    // it is simply not extended.
    const token = tokenFor(Date.now() + 10 * DAY);
    store(token);
    const renew = vi.fn(() => Promise.resolve({ ok: false as const, reason: "rotated" }));
    expect(await renewMemberTokenIfDue(renew)).toBe(false);
    expect(window.localStorage.getItem(KEY)).toBe(token);
    expect(window.localStorage.getItem(NAME_KEY)).toBe("Doug");
  });

  it("keeps the old token when the server refuses", async () => {
    const token = tokenFor(Date.now() + 10 * DAY);
    store(token);
    const renew = vi.fn(() => Promise.resolve({ ok: false as const, reason: "no_player" }));
    expect(await renewMemberTokenIfDue(renew)).toBe(false);
    expect(window.localStorage.getItem(KEY)).toBe(token);
  });

  it("tries again on a later call after a failure", async () => {
    store(tokenFor(Date.now() + 10 * DAY));
    const fresh = tokenFor(Date.now() + 90 * DAY);
    const renew = vi
      .fn<Renew>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ ok: true, token: fresh, expiresAt: Date.now() + 90 * DAY });
    expect(await renewMemberTokenIfDue(renew)).toBe(false);
    expect(await renewMemberTokenIfDue(renew)).toBe(true);
    expect(window.localStorage.getItem(KEY)).toBe(fresh);
  });

  it("drops a late answer once the device has become somebody else", async () => {
    // The request was out when the phone switched player; the old identity's
    // renewal must not be written back over the new one.
    store(tokenFor(Date.now() + 10 * DAY));
    let resolve!: (v: { ok: true; token: string; expiresAt: number }) => void;
    const renew = vi.fn(
      () => new Promise<{ ok: true; token: string; expiresAt: number }>((r) => (resolve = r)),
    );
    const pending = renewMemberTokenIfDue(renew);
    const theirs = tokenFor(Date.now() + 90 * DAY, OTHER_ID);
    store(theirs, "Bob");
    resolve({ ok: true, token: tokenFor(Date.now() + 90 * DAY), expiresAt: Date.now() + 90 * DAY });
    expect(await pending).toBe(false);
    expect(window.localStorage.getItem(KEY)).toBe(theirs);
  });

  it("drops a late answer after a sign-out", async () => {
    store(tokenFor(Date.now() + 10 * DAY));
    let resolve!: (v: { ok: true; token: string; expiresAt: number }) => void;
    const renew = vi.fn(
      () => new Promise<{ ok: true; token: string; expiresAt: number }>((r) => (resolve = r)),
    );
    const pending = renewMemberTokenIfDue(renew);
    window.localStorage.removeItem(KEY);
    resolve({ ok: true, token: tokenFor(Date.now() + 90 * DAY), expiresAt: Date.now() + 90 * DAY });
    expect(await pending).toBe(false);
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });
});
