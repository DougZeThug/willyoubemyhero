// Payload-free trade nudges.
//
// Two things here are load-bearing rather than incidental, and both are pinned
// below: a topic must not be derivable from a participant id, and the event must
// carry nothing. Together they are the entire argument for why an unguessable
// public channel is an acceptable substitute for auth this app does not have.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendTradeNudge, tradeNudgeTopic } from "./nudge.server";
import { TRADE_NUDGE_EVENT } from "./trades";

const ALICE = "00000000-0000-4000-8000-0000000000aa";
const BOB = "00000000-0000-4000-8000-0000000000bb";
const URL = "http://127.0.0.1:54321";

/** The one fetch the module makes, as it was called. */
type Sent = { url: string; init: RequestInit };

function stubFetch(response: Response | Error = new Response(null, { status: 202 })) {
  const sent: Sent[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      sent.push({ url, init });
      return response instanceof Error ? Promise.reject(response) : Promise.resolve(response);
    }),
  );
  return sent;
}

const bodyOf = (s: Sent) => JSON.parse(String(s.init.body));
const headersOf = (s: Sent) => s.init.headers as Record<string, string>;

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-session-secret");
  vi.stubEnv("SUPABASE_URL", URL);
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "legacy.jwt.key");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("tradeNudgeTopic", () => {
  it("says nothing about who it is for", () => {
    // The whole guard. A topic that embedded the participant id would be derivable
    // by anyone holding a roster, which is everyone.
    expect(tradeNudgeTopic(ALICE)).not.toContain(ALICE);
  });

  it("is 16 base64url characters under a versioned prefix", () => {
    // 96 bits. Versioned so the derivation can move without stranding a deployed
    // client on a topic the server has stopped poking.
    expect(tradeNudgeTopic(ALICE)).toMatch(/^nudge:v1:[A-Za-z0-9_-]{16}$/);
  });

  it("is the same every time, or the two sides would never meet", () => {
    expect(tradeNudgeTopic(ALICE)).toBe(tradeNudgeTopic(ALICE));
  });

  it("gives two members different topics", () => {
    expect(tradeNudgeTopic(ALICE)).not.toBe(tradeNudgeTopic(BOB));
  });

  it("changes with the secret, so a leaked topic dies when SESSION_SECRET rotates", () => {
    const before = tradeNudgeTopic(ALICE);
    vi.stubEnv("SESSION_SECRET", "a-different-secret");
    expect(tradeNudgeTopic(ALICE)).not.toBe(before);
  });

  it("refuses to invent a topic with no secret to derive it from", () => {
    vi.stubEnv("SESSION_SECRET", "");
    expect(() => tradeNudgeTopic(ALICE)).toThrow(/SESSION_SECRET/);
  });
});

describe("sendTradeNudge", () => {
  it("posts one empty-payload message to the recipient's topic", async () => {
    const sent = stubFetch();
    await sendTradeNudge(ALICE);

    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe(`${URL}/realtime/v1/api/broadcast`);
    expect(sent[0].init.method).toBe("POST");
    expect(bodyOf(sent[0])).toEqual({
      messages: [
        {
          topic: tradeNudgeTopic(ALICE),
          event: TRADE_NUDGE_EVENT,
          payload: {},
          // Public: private channels authorize through RLS against a per-user
          // session this app does not have.
          private: false,
        },
      ],
    });
  });

  it("carries nothing about the trade in the payload", async () => {
    // Pinned separately from the shape above because this is the privacy claim,
    // not a detail: an offer id in here would make an unguessable public channel
    // an actual leak rather than a timing one.
    const sent = stubFetch();
    await sendTradeNudge(ALICE);
    expect(bodyOf(sent[0]).messages[0].payload).toEqual({});
  });

  it("authenticates a legacy JWT key as a bearer token", async () => {
    const sent = stubFetch();
    await sendTradeNudge(ALICE);
    expect(headersOf(sent[0]).apikey).toBe("legacy.jwt.key");
    expect(headersOf(sent[0]).Authorization).toBe("Bearer legacy.jwt.key");
  });

  it("never presents a new opaque key as a bearer token", async () => {
    // The distinction client.server.ts makes: an `sb_secret_` key is not a JWT and
    // is rejected outright when sent as one.
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_abc123");
    const sent = stubFetch();
    await sendTradeNudge(ALICE);
    expect(headersOf(sent[0]).apikey).toBe("sb_secret_abc123");
    expect(headersOf(sent[0]).Authorization).toBeUndefined();
  });

  it("gives up rather than hanging on to a trade", async () => {
    const sent = stubFetch();
    await sendTradeNudge(ALICE);
    expect(sent[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it("resolves when Realtime refuses", async () => {
    // A dropped nudge is slow, not broken — useTradeOffers still refetches on
    // focus. Throwing here would fail the trade that caused it.
    stubFetch(new Response(null, { status: 500 }));
    await expect(sendTradeNudge(ALICE)).resolves.toBeUndefined();
  });

  it("resolves when the request never lands at all", async () => {
    stubFetch(new Error("network down"));
    await expect(sendTradeNudge(ALICE)).resolves.toBeUndefined();
  });

  it("stays quiet when there is no Supabase configured to poke", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const sent = stubFetch();
    await sendTradeNudge(ALICE);
    expect(sent).toHaveLength(0);
  });
});
