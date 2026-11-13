/**
 * Tell a participant their trade feed changed, from a server-function handler.
 *
 * Imported dynamically because nudge.server.ts reaches for node:crypto, and a
 * top-level import in a `*.functions.ts` file would drag it into the client bundle.
 * The payload-free broadcast itself is described in nudge.server.ts. Trades and
 * market sales poke the same per-participant topic rather than two: it is one HMAC
 * per participant and the event carries nothing, so a second listener would only
 * cost an extra refetch.
 *
 * Awaited, but it cannot fail: sendTradeNudge swallows everything and gives up
 * after two seconds. A trade or sale must never fail because Realtime did.
 */
export async function nudge(participantId: string) {
  try {
    const { sendTradeNudge } = await import("./nudge.server");
    await sendTradeNudge(participantId);
  } catch {
    // Belt and braces on top of sendTradeNudge already swallowing its own
    // failures: the layer that holds if that ever stops being true, and what
    // makes "a broken nudge does not break a trade" a fact rather than a promise
    // about another module.
  }
}
