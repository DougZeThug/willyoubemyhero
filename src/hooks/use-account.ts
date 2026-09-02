import { useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { syncAccountSession } from "@/lib/account.functions";
import { setMemberToken, clearMemberToken, getMemberToken } from "@/lib/member-token";
import { setGuestToken, clearGuestToken } from "@/lib/guest-token";
import { clearAdminToken } from "@/lib/admin-token";
import { adoptLocalCollection, snapshotLocalCollection } from "@/lib/adopt-collection";
import { clearAccountHandoff } from "@/lib/account-handoff";
import { setAccountSyncState } from "@/lib/account-sync-state";

/** The Supabase user this browser is signed in as, or null. */
export function useAuthUser(): { user: User | null; loading: boolean } {
  // Starts null so the server render and the first client render agree.
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!alive) return;
      setUser(session?.user ?? null);
      setLoading(false);
    });
    void supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setUser(data.session?.user ?? null);
      setLoading(false);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { user, loading };
}

/**
 * Keep this device's collection token in step with the signed-in account.
 *
 * Mounted once, at the root. The sync is latched per user id: the token it
 * writes fires `wwbh:member-token-changed`, which re-renders half the app, and
 * running it again on every auth event would loop.
 */
export function useAccountSync(user: User | null) {
  const syncedFor = useRef<string | null>(null);
  // Whose run last started on this device. Deliberately not cleared on
  // sign-out: it is how the next run knows the member token it finds belongs to
  // somebody else.
  const lastStarted = useRef<string | null>(null);
  // Bumped when a sync that gave up should be tried again for the same user.
  const [wake, setWake] = useState(0);
  // The id, not the object. Supabase hands out a fresh User on every token
  // refresh, and an effect keyed on the object cancelled a sync mid-adoption for
  // an identity that had not changed — the guarded returns below then skipped
  // the ready state, the latch skipped the re-run, and the account screen sat
  // on "syncing" until a reload.
  const authUserId = user?.id ?? null;

  useEffect(() => {
    if (!authUserId) {
      syncedFor.current = null;
      setAccountSyncState({ status: "idle", userId: null, message: null });
      return;
    }
    // Narrowed once here: the closures below cannot see the guard above.
    const userId: string = authUserId;
    if (syncedFor.current === userId) return;
    // A different account from the one whose run last started here. Whatever
    // member token is on the device is that account's, and syncAccount binds a
    // first-time account to the token in the headers — so it comes off before
    // this run's first request, whether or not the previous run ever got as far
    // as writing one. A device that has never run a sync keeps its token: that
    // is the paper-code-then-sign-in path, where the token IS the identity the
    // account should adopt.
    if (lastStarted.current && lastStarted.current !== userId) clearMemberToken();
    lastStarted.current = userId;
    syncedFor.current = userId;
    setAccountSyncState({ status: "syncing", userId, message: null });

    // A slow sync for the previous user must never land after a sign-out or an
    // account switch: the device would then act as that stale identity.
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let wakeTimer: ReturnType<typeof setTimeout> | undefined;
    let forgetOnline: (() => void) | undefined;

    // Snapshotted once, before the first token lands, for the same reason as
    // the claim page: once this device is a member, its unrecognised local cards
    // are pruned, and a guest's base cards exist nowhere else. Read once rather
    // than per attempt, because a retry after the prune has run would snapshot
    // a store that has already lost them.
    let held: Awaited<ReturnType<typeof snapshotLocalCollection>> | null = null;
    // The member token this run wrote, so the cleanup can take back exactly
    // that one and nothing a newer run has written since.
    let wrote: string | null = null;

    async function runSync() {
      held ??= await snapshotLocalCollection();
      const res = await syncAccountSession({ data: undefined });
      if (cancelled) return;
      if (res.kind === "member") {
        setMemberToken(res.token, res.name ?? "Player");
        wrote = res.token;
        // Every await below is a moment the account can change under this sync.
        // Once it has, the tokens belong to the new user's run: a stale rejection
        // must not clear the member token that run just wrote, and a stale
        // success must not clear its guest token. Hence the checks after each.
        try {
          await adoptLocalCollection(held);
        } catch {
          if (cancelled) return;
          try {
            // One retry, because the usual failure here is a flaky first request
            // from a phone that has just woken up on garden wifi.
            await adoptLocalCollection(held);
          } catch (e) {
            if (cancelled) return;
            // The claim screen's rule, which this path used to skip: if the
            // upload does not stick, the token comes straight back off. No
            // member, no reconciliation, nothing pruned — and the throw hands
            // the whole sync to the retry loop below, so a later attempt gets
            // the same snapshot rather than a store the prune has been through.
            clearMemberToken();
            throw e;
          }
        }
        if (cancelled) return;
        // Only now. Clearing it before the upload left a phone whose adoption
        // failed with no identity at all, and its cards filed under neither.
        clearGuestToken();
      } else {
        clearMemberToken();
        setGuestToken(res.token);
      }
      clearAccountHandoff();
      setAccountSyncState({ status: "ready", userId, message: null });
    }

    void (async () => {
      // A failed sync used to be silent, and silence here is expensive: the
      // device keeps whatever identity it minted for itself, so somebody who
      // signed in on a flaky connection sits in front of an empty vault while
      // their real collection is safe on the server. Retry a few times, backing
      // off, before giving up.
      for (let attempt = 0; attempt < 4 && !cancelled; attempt++) {
        try {
          await runSync();
          return;
        } catch {
          if (cancelled) return;
          const wait = 1000 * 2 ** attempt;
          await new Promise<void>((resolve) => {
            retry = setTimeout(resolve, wait);
          });
        }
      }
      // Still unsynced: unlatch so a later auth event (a token refresh, a
      // revisit) gets another go rather than the device being stuck.
      if (!cancelled) syncedFor.current = null;
      if (!cancelled) {
        setAccountSyncState({
          status: "error",
          userId,
          message: "Your cards are safe, but this phone could not finish linking them.",
        });
        // Keyed on the id, nothing about the user re-runs this on its own any
        // more — a token refresh used to, by accident. So the next go is
        // scheduled here: a minute, or the radio coming back, whichever first.
        const bump = () => setWake((n) => n + 1);
        wakeTimer = setTimeout(bump, 60_000);
        window.addEventListener("online", bump, { once: true });
        forgetOnline = () => window.removeEventListener("online", bump);
      }
    })();

    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      if (wakeTimer) clearTimeout(wakeTimer);
      forgetOnline?.();
      // A different account is taking over this device. The token this run
      // wrote must be gone before that account's sync reads the headers:
      // syncAccount takes `x-member-token` as the player to bind a new account
      // to, so leaving it would link the next person to this one's collection.
      // Compare-and-clear, so a token a newer run has already replaced stays.
      if (wrote && getMemberToken() === wrote) clearMemberToken();
    };
  }, [authUserId, wake]);
}

/**
 * Sign out and drop the member identity.
 *
 * The GUEST token deliberately survives. It is a pointer to a collection, not
 * an authorisation to act as anybody, and clearing it orphaned the cards an
 * unnamed visitor had pulled on this handset: the next visit minted a fresh
 * guest id and the vault looked empty. Signing back in re-adopts (and merges)
 * whatever this device holds, so leaving it in place is strictly safer.
 */
export async function signOutAccount() {
  await supabase.auth.signOut();
  clearMemberToken();
  clearAdminToken();
}
