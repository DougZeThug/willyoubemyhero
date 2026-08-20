import { useEffect, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { startGuestSession } from "@/lib/guest.functions";
import { getGuestToken, setGuestToken, useGuestSession } from "@/lib/guest-token";
import { getMemberToken, useMemberSession } from "@/lib/member-token";

/**
 * Make sure this device has an identity it can own a secret card with.
 *
 * Only ever called from the pack screen, and only for a visitor who has not
 * claimed a player: a member already has an identity, and minting a guest one
 * beside it would be a second collection nobody asked for.
 *
 * Latched by a ref rather than by the token in state, because the token arrives
 * asynchronously — without the latch, a remount or a second render before the
 * response lands mints a second identity and abandons the first, taking whatever
 * was pulled on it.
 */
export function useEnsureGuestSession(enabled: boolean) {
  const member = useMemberSession();
  const guest = useGuestSession();
  const start = useServerFn(startGuestSession);
  const firedRef = useRef(false);
  const priorMemberRef = useRef(member);

  useEffect(() => {
    // Signing out (usually in another tab) clears both tokens, so the latch has
    // to drop with them — otherwise the re-run this dependency exists for exits
    // one line later and the phone sits with no identity until it navigates.
    if (priorMemberRef.current && !member) firedRef.current = false;
    priorMemberRef.current = member;

    if (!enabled || firedRef.current) return;
    // Both reads go straight to storage rather than to the hook state above,
    // which is null for one render on every mount while it hydrates. Trusting
    // `member` here would mint a pointless second identity for every claimed
    // member on their first frame, and trusting `guest` would mint a second one
    // for a guest who already had a perfectly good session.
    if (getMemberToken() || getGuestToken()) return;
    firedRef.current = true;

    void (async () => {
      try {
        const res = await start({});
        if (res?.token) setGuestToken(res.token);
      } catch {
        // A guest without a session simply gets no fourth card, which is exactly
        // the behaviour that shipped before guests could pull at all.
        firedRef.current = false;
      }
    })();
    // `member` is a dependency but not read in the body: it is here so signing
    // out re-runs this and the phone picks up a guest identity, rather than
    // sitting there with no way to pull until the next navigation.
  }, [enabled, member, start]);

  return guest;
}
