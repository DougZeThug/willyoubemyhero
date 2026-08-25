import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getActiveEvent } from "@/lib/event.functions";

/**
 * The active event, and nothing else.
 *
 * Split out of useEventBundle so the app shell can ask whether dust is switched
 * on without dragging the rest of that hook along. The bundle hook opens a
 * realtime channel in an effect — one websocket per mounted hook, keyed on the
 * event — and SiteNav renders on every screen, so mounting it up there would put
 * a socket on the leaderboard, the TV board and the claim page. That is the exact
 * thing e2e/fixtures.ts keeps `nudgeTopic` null to prevent, and smoke.spec.ts
 * asserts on the console errors it produces.
 *
 * The key and staleTime are deliberately identical to the query this was lifted
 * out of. That is what makes it free: every screen that already calls
 * useEventBundle has this in cache, so the shell reads it rather than asking
 * again — and the nav can never disagree with the page about whether the dust
 * economy is live, which it could if this had a key of its own.
 *
 * Its own module rather than a second export from use-event-bundle.ts, so
 * importing it does not pull the realtime client into the chunk that holds the
 * nav.
 */
export function useActiveEvent() {
  const fn = useServerFn(getActiveEvent);
  return useQuery({
    queryKey: ["active-event"],
    queryFn: () => fn(),
    staleTime: 60_000,
  });
}
