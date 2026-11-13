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
// shared-channel.ts is the answer: a grace timer that makes unsubscribe-then-
// resubscribe a pure no-op (what StrictMode needs), and a removal that is awaited
// before the topic can be reopened. Same shape as event-channel.ts, deliberately
// without its health tracking and backstop poll: the backstop here is the
// `refetchOnWindowFocus` already on useTradeOffers, and a second app-wide poller
// is not free.
import { browserSupabase, type BrowserSupabase } from "@/lib/browser-supabase";
import { createSharedChannels } from "./shared-channel";
import { TRADE_NUDGE_EVENT } from "./trades";
type NudgeChannel = ReturnType<BrowserSupabase["channel"]>;

/**
 * Long enough to cover a StrictMode remount and a route change, which is the same
 * reason event-channel.ts holds its own socket open for the same interval.
 */
export const NUDGE_TEARDOWN_GRACE_MS = 5_000;

/**
 * Join a nudge topic, and return the unsubscribe.
 *
 * The topic is used VERBATIM — no sequence number, no random suffix. It has to
 * match what nudge.server.ts broadcasts to, and a "uniquified" topic here would
 * break delivery silently rather than loudly.
 */
export const subscribeToNudges = createSharedChannels<() => void, { channel: NudgeChannel | null }>(
  {
    graceMs: NUDGE_TEARDOWN_GRACE_MS,
    open: (topic, { subscribers, whenReady }) => {
      const state: { channel: NudgeChannel | null } = { channel: null };
      const fanOut = () => {
        // Copied out before iterating: a subscriber that unsubscribes from its own
        // callback would otherwise mutate the set mid-loop.
        for (const notify of [...subscribers]) notify();
      };
      whenReady(() => {
        // No client on this device: nudges are a nicety, the feed still refetches.
        const supabase = browserSupabase();
        if (!supabase) return;
        state.channel = supabase
          .channel(topic)
          .on("broadcast", { event: TRADE_NUDGE_EVENT }, fanOut)
          .subscribe((status) => {
            // THE JOIN ITSELF IS A REFETCH. Whatever changed between
            // getMyTradeOffers reading the database and this channel joining was
            // broadcast to nobody — the listener did not exist yet — so without this
            // the badge stays stale until the next window focus, which on a desktop
            // left open is a long time. Costs one extra read per join; a rejoin after
            // the socket drops gets the same treatment, for the same reason
            // event-channel.ts refetches on its degraded-to-live recovery.
            if (status === "SUBSCRIBED") fanOut();
          });
      });
      return state;
    },
    // A channel never opened (torn down while still waiting its turn) has nothing to remove.
    close: ({ channel }) => (channel ? browserSupabase()?.removeChannel(channel) : undefined),
  },
);
