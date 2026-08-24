// Payload-free realtime nudges, one topic per participant.
//
// WHY THIS EXISTS AT ALL. `trade_offers` is deliberately not in the
// supabase_realtime publication — publishing it would make it anon-readable, and
// an offer names cards both parties hold. See the header on use-trades.ts and the
// column comments in 20260817120000_card_trading.sql. So there was no live signal
// for an offer arriving, only useTradeOffers' focus refetch.
//
// A BROADCAST TOPIC IS NOT A TABLE. Nothing is published, nothing is readable,
// nothing is stored. The server pokes a topic and the recipient's client refetches
// through the same member-guarded handler it always used, so this widens the
// surface by exactly nothing.
//
// THE TOPIC IS THE WHOLE GUARD. There is no per-user Supabase auth in this app, so
// private channels — which key off RLS on realtime.messages — are unavailable. A
// topic is 96 bits of HMAC over SESSION_SECRET, which is what stands between it and
// a guess. That is enough BECAUSE THE EVENT CARRIES NOTHING: somebody who learned a
// topic could learn "this person has trade activity" and could forge a spurious
// refetch, which hands the victim back their own member-guarded truth. Keep the
// payload empty and that stays true. Put an offer id in it and it stops being.
import { hmac } from "./session.server";
import { TRADE_NUDGE_EVENT } from "./trades";

/**
 * The topic one participant listens on.
 *
 * Versioned so the derivation can change without a deployed client sitting on a
 * topic the server has stopped poking. Truncated to 16 base64url chars — 96 bits,
 * far past guessable for a league of thirteen, and short enough to read in a log.
 *
 * Derived from the participant id and the server secret rather than from a token,
 * because the caller computing this is never the person it is about: the whole
 * point is to poke the OTHER side of a trade, whose token the server never holds.
 */
export function tradeNudgeTopic(participantId: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  return `nudge:v1:${hmac(`trade-nudge:${participantId}`, secret).slice(0, 16)}`;
}

/** New Supabase API keys are opaque strings, not bearer JWTs. */
function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

/** A nudge may never hold a trade open. Realtime is not on the critical path. */
const SEND_TIMEOUT_MS = 2_000;

/**
 * Poke one participant's topic. Never throws, whatever happens.
 *
 * The REST endpoint rather than `supabaseAdmin.channel(t).send(...)`: supabase-js
 * does fall back to this same URL for an unsubscribed channel, but it builds a
 * RealtimeChannel bound to the socket and leaves it in the client's registry —
 * machinery a Worker isolate that is about to be torn down has no use for.
 *
 * Awaited rather than left floating. The isolate can be reclaimed the moment the
 * response is sent and there is no `waitUntil` reachable from a server function, so
 * a floating promise may simply never flush. The abort signal is what keeps that
 * honest: a Realtime that hangs costs the trade two seconds, not the trade.
 */
export async function sendTradeNudge(participantId: string): Promise<void> {
  try {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return;

    const headers: Record<string, string> = {
      "content-type": "application/json",
      apikey: key,
    };
    // Same distinction client.server.ts makes, and for the same reason: an opaque
    // key presented as a bearer token is rejected.
    if (!isNewSupabaseApiKey(key)) headers.Authorization = `Bearer ${key}`;

    const res = await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        messages: [
          {
            topic: tradeNudgeTopic(participantId),
            event: TRADE_NUDGE_EVENT,
            // EMPTY, and it stays empty. See the header.
            payload: {},
            // Public, because private channels authorize through RLS on
            // realtime.messages against a per-user session this app does not have.
            // Stated explicitly rather than left to default, so somebody changing
            // the posture has to read it.
            private: false,
          },
        ],
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    // Never leave a body unread in a Worker isolate.
    await res.body?.cancel();
    if (!res.ok) {
      // Warn rather than throw: the badge and useTradeOffers' focus refetch are
      // the backstop, so a dropped nudge is slow, not broken.
      //
      // The status and NOTHING ELSE. A log line carrying a topic beside the
      // participant id it was derived from would undo the point of deriving it.
      console.warn(`[nudge] broadcast refused: ${res.status}`);
    }
  } catch (error) {
    console.warn("[nudge] broadcast failed", error);
  }
}
