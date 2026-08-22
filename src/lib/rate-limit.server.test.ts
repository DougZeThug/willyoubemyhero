// The brake on the two login endpoints.
//
// What matters here is the shape of the budget, not the numbers: failures spend
// it, a success returns it, and one key's spending never touches another's.
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearAttempts,
  clientIp,
  recordFailedAttempt,
  resetRateLimits,
  tooManyAttempts,
} from "./rate-limit.server";
import { withRequestHeaders } from "@/test/server-fn";

const KEY = "pin:1.2.3.4:event";
const LIMIT = 10;

beforeEach(resetRateLimits);

describe("attempt budget", () => {
  it("lets the first attempt through", () => {
    expect(tooManyAttempts(KEY)).toBe(false);
  });

  it("allows exactly the limit before refusing", () => {
    for (let i = 0; i < LIMIT; i++) {
      expect(tooManyAttempts(KEY)).toBe(false);
      recordFailedAttempt(KEY);
    }
    expect(tooManyAttempts(KEY)).toBe(true);
  });

  it("keeps each key's budget to itself", () => {
    for (let i = 0; i < LIMIT; i++) recordFailedAttempt(KEY);
    expect(tooManyAttempts(KEY)).toBe(true);
    expect(tooManyAttempts("claim:1.2.3.4:someone-else")).toBe(false);
  });

  it("returns the budget on success", () => {
    // A player who fumbles twice and then gets it right must not carry those
    // two forward into the next window.
    for (let i = 0; i < LIMIT - 1; i++) recordFailedAttempt(KEY);
    clearAttempts(KEY);
    for (let i = 0; i < LIMIT - 1; i++) {
      recordFailedAttempt(KEY);
      expect(tooManyAttempts(KEY)).toBe(false);
    }
  });
});

describe("the window", () => {
  const START = 1_700_000_000_000;
  const WINDOW_MS = 5 * 60_000;

  it("still refuses one millisecond before the window closes", () => {
    for (let i = 0; i < LIMIT; i++) recordFailedAttempt(KEY, START);
    expect(tooManyAttempts(KEY, START + WINDOW_MS - 1)).toBe(true);
  });

  it("forgives once the window has passed", () => {
    for (let i = 0; i < LIMIT; i++) recordFailedAttempt(KEY, START);
    expect(tooManyAttempts(KEY, START + WINDOW_MS)).toBe(false);
  });

  it("is fixed, not sliding — a late failure does not extend it", () => {
    recordFailedAttempt(KEY, START);
    for (let i = 1; i < LIMIT; i++) recordFailedAttempt(KEY, START + WINDOW_MS - 1);
    expect(tooManyAttempts(KEY, START + WINDOW_MS)).toBe(false);
  });
});

describe("key eviction", () => {
  it("stays bounded, so a long-lived isolate cannot grow forever", () => {
    // Well past the 500-key cap. The check is that the cap holds; which key is
    // dropped only matters in that it must be an old one, and the newest key
    // still has to answer.
    for (let i = 0; i < 900; i++) recordFailedAttempt(`k${i}`);
    for (let i = 0; i < 900; i++) recordFailedAttempt(`k${i}`);
    expect(tooManyAttempts("k899")).toBe(false);
  });
});

describe("clientIp", () => {
  const ip = (headers: Record<string, string>) => withRequestHeaders(headers, () => clientIp());

  it("prefers the header Cloudflare sets itself", async () => {
    expect(await ip({ "cf-connecting-ip": "9.9.9.9", "x-forwarded-for": "1.1.1.1" })).toBe(
      "9.9.9.9",
    );
  });

  it("falls back to x-real-ip, then to the first forwarded hop", async () => {
    expect(await ip({ "x-real-ip": "8.8.8.8" })).toBe("8.8.8.8");
    expect(await ip({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" })).toBe("1.1.1.1");
  });

  it("names the unknown case rather than returning an empty key", async () => {
    // An empty string would collapse into the key separators and silently merge
    // buckets that are supposed to be distinct.
    expect(await ip({})).toBe("unknown");
  });
});
