import { useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { toast } from "sonner";
import { startAdminSessionFromAccount } from "@/lib/admin.functions";
import { setAdminToken } from "@/lib/admin-token";

/**
 * Accounts on the admin list skip the PIN: ask the server once per signed-in
 * account, and plant the token it hands back. Returns whether that check has
 * finished, so the page can hold the PIN gate back until it has.
 *
 * The answer is only planted if the account that asked is still the one signed
 * in. The call can take seconds, and a sign-out followed by another account's
 * sign-in inside that window would otherwise leave the first account's console
 * on the handset, owned by them, while `bindAdminTokenTo` — which only runs when
 * the signed-in account changes — had already looked at an empty store.
 *
 * A ref of who is current rather than an effect-cleanup flag, on purpose: the
 * effect re-runs whenever `user` changes identity, which Supabase does on every
 * token refresh for the SAME account, and `triedFor` stops that re-run from
 * asking again. A cleanup flag would discard the answer of the only request ever
 * made and leave the page on "Checking access…" for good.
 *
 * Who is current is not enough on its own, though. A sign-out resets the latch so
 * the same account is asked again, and the request it left in the air is still
 * coming back: when the account returns, that request passes a who-is-current
 * check and plants its `ok` over whatever the fresh request said. Each request
 * therefore also carries a number, and only the newest is heard.
 *
 * An account that arrives already holding its console (a stored token) is
 * latched as asked too. Lock clears that token, and without the latch the clear
 * reads as a first visit and the server hands the console straight back. The same
 * branch voids any request already in the air, so its late answer cannot do it.
 *
 * "Once" means once per answer, not once per session: a request that threw, or
 * that found no live event, is asked again on the next auth event (the same
 * unlatch-on-failure `useAccountSync` does). A plain "not an admin" is final.
 */
export function useAdminAutoUnlock(isAdmin: boolean, user: User | null, authLoading: boolean) {
  const [accountChecked, setAccountChecked] = useState(false);
  const triedFor = useRef<string | null>(null);
  // The account whose first check has finished. A retry after a transient
  // failure must not blank `accountChecked` again, or the PIN gate would vanish
  // under a commissioner who is already typing their PIN.
  const settledFor = useRef<string | null>(null);
  const currentUserId = useRef<string | null>(null);
  // The newest request made, whoever it was for. Never reset: a number that went
  // back to zero could match a request from before the reset.
  const latestRequest = useRef(0);
  const userId = user?.id ?? null;

  // Declared before the effect below so both see the new account in one commit.
  useEffect(() => {
    currentUserId.current = userId;
  }, [userId]);

  useEffect(() => {
    if (authLoading) return;
    if (isAdmin) {
      // Nothing to ask, but remember being here. The only way `isAdmin` goes false
      // under a signed-in account is Lock (or the token running out, which lands on
      // the PIN gate too until a reload: the two look the same from here). Neither
      // is a first visit to answer with a new token.
      //
      // Holding the console also voids any request still in the air. One asked
      // while `isAdmin` was false (a cold load) would otherwise still be the newest
      // when it lands, pass the staleness check for the same signed-in account, and
      // re-plant the token over a Lock the commissioner has just pressed.
      latestRequest.current++;
      if (user) {
        triedFor.current = user.id;
        settledFor.current = user.id;
      }
      setAccountChecked(true);
      return;
    }
    if (!user) {
      // Forgotten with the account: an answer discarded while signed out was never
      // heard, and the same account signing back in must be asked again rather than
      // skipped on a latch that outlived its request.
      triedFor.current = null;
      settledFor.current = null;
      setAccountChecked(true);
      return;
    }
    const askedFor = user.id;
    if (triedFor.current === askedFor) return;
    triedFor.current = askedFor;
    // A different account than the one a previous check settled for: the PIN gate
    // must not flash for them while their own answer is on its way.
    if (settledFor.current !== askedFor) setAccountChecked(false);
    const request = ++latestRequest.current;
    // Superseded by a newer request, or asked for an account that is not here now.
    const stale = () => latestRequest.current !== request || currentUserId.current !== askedFor;
    void (async () => {
      // A failed call and "no event is live yet" are both passing conditions, so
      // they hand the latch back and the next auth event (a token refresh) asks
      // again. "not_admin" is a settled answer and stays latched: re-asking every
      // signed-in player on every refresh would only hear the same no.
      let retryable = false;
      try {
        const res = await startAdminSessionFromAccount({ data: undefined });
        if (stale()) return;
        if (res.ok) {
          setAdminToken(res.token, askedFor);
          toast.success("Admin unlocked via your account");
        } else if (res.reason === "event_not_found") {
          retryable = true;
        }
      } catch {
        /* fall through to the PIN gate */
        retryable = true;
      } finally {
        // The account that is signed in now has its own check, or none to make.
        if (!stale()) {
          settledFor.current = askedFor;
          if (retryable && triedFor.current === askedFor) triedFor.current = null;
          setAccountChecked(true);
        }
      }
    })();
  }, [isAdmin, user, authLoading]);

  return accountChecked;
}
