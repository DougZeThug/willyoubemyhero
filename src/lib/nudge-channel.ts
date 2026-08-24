// One realtime channel per nudge topic, shared by everything on the page.
//
// WHY THIS IS NOT JUST A useEffect. Every other channel in this app dodges topic
// collisions by RANDOMISING the name — `event:${eventId}:${++channelSeq}` in
// event-channel.ts, `trades:${eventId}:${Math.random()}` in use-trades.ts. A
// broadcast LISTENER cannot do that: it has to join the exact topic the server
// publishes to, byte for byte, or it hears nothing. That inverts the collision
// story, and three behaviours of @supabase/realtime-js then bite:
//
//   1. `RealtimeClient.channel(topic)` returns the EXISTING channel when that topic
//      is already registered, rather than a fresh one.
//   2. `removeChannel()` awaits an unsubscribe, and the channel only leaves
//      `socket.channels` later, on the close callback.
//   3. `subscribe()` only actually joins when the channel is closed. On one that is
//      joined or still leaving it is a SILENT no-op — no error, no callback.
//
// Together: unmount then remount inside the teardown window hands you back a
// half-dead channel, re-binds the handler to it, no-ops the subscribe, and then
// finishes leaving. The app ends up with no subscription and nothing anywhere says
// so. React StrictMode does exactly that on every mount in development.
//
// The grace timer makes an unsubscribe-then-resubscribe a pure no-op, which is
// precisely what StrictMode needs. Same shape as event-channel.ts, deliberately
// without its health tracking and backstop poll: the backstop here is the
// `refetchOnWindowFocus` already on useTradeOffers, and a second app-wide poller
// is not free.
import { supabase } from "@/integrations/supabase/client";
import { TRADE_NUDGE_EVENT } from "./trades";

type NudgeChannel = ReturnType<typeof supabase.channel>;

type Entry = {
  channel: NudgeChannel;
  subscribers: Set<() => void>;
  teardown: ReturnType<typeof setTimeout> | null;
};

/**
 * Long enough to cover a StrictMode remount and a route change, which is the same
 * reason event-channel.ts holds its own socket open for the same interval.
 */
export const NUDGE_TEARDOWN_GRACE_MS = 5_000;

const entries = new Map<string, Entry>();

function openChannel(topic: string): Entry {
  const entry: Entry = {
    channel: undefined as unknown as NudgeChannel,
    subscribers: new Set(),
    teardown: null,
  };
  entries.set(topic, entry);

  entry.channel = supabase
    .channel(topic)
    .on("broadcast", { event: TRADE_NUDGE_EVENT }, () => {
      // Copied out before iterating: a subscriber that unsubscribes from its own
      // callback would otherwise mutate the set mid-loop.
      for (const notify of [...entry.subscribers]) notify();
    })
    .subscribe();

  return entry;
}

/**
 * Join a nudge topic, and return the unsubscribe.
 *
 * The topic is used VERBATIM — no sequence number, no random suffix. It has to
 * match what nudge.server.ts broadcasts to, and a "uniquified" topic here would
 * break delivery silently rather than loudly.
 */
export function subscribeToNudges(topic: string, onNudge: () => void): () => void {
  let entry = entries.get(topic);
  if (!entry) {
    entry = openChannel(topic);
  } else if (entry.teardown) {
    clearTimeout(entry.teardown);
    entry.teardown = null;
  }
  const joined = entry;
  joined.subscribers.add(onNudge);

  return () => {
    joined.subscribers.delete(onNudge);
    if (joined.subscribers.size > 0 || joined.teardown) return;
    // Somebody already replaced this entry — leave theirs alone.
    if (entries.get(topic) !== joined) return;
    joined.teardown = setTimeout(() => {
      if (entries.get(topic) !== joined || joined.subscribers.size > 0) return;
      entries.delete(topic);
      void supabase.removeChannel(joined.channel);
    }, NUDGE_TEARDOWN_GRACE_MS);
  };
}
