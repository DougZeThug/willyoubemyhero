import { useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { syncAccountSession } from "@/lib/account.functions";
import { setMemberToken, clearMemberToken } from "@/lib/member-token";
import { setGuestToken, clearGuestToken } from "@/lib/guest-token";
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

  useEffect(() => {
    if (!user) {
      syncedFor.current = null;
      setAccountSyncState({ status: "idle", userId: null, message: null });
      return;
    }
    const userId = user.id;
    if (syncedFor.current === userId) return;
    syncedFor.current = userId;
    setAccountSyncState({ status: "syncing", userId, message: null });

    // A slow sync for the previous user must never land after a sign-out or an
    // account switch: the device would then act as that stale identity.
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    async function runSync() {
      // Snapshotted before the token changes, for the same reason as the claim
      // page: once this device is a member, its unrecognised local cards are
      // pruned, and a guest's base cards exist nowhere else.
      const held = await snapshotLocalCollection();
      const res = await syncAccountSession({ data: undefined });
      if (cancelled) return;
      if (res.kind === "member") {
        setMemberToken(res.token, res.name ?? "Player");
        clearGuestToken();
        try {
          await adoptLocalCollection(held);
        } catch {
          /* signed in without the upload: the cards can be granted back */
        }
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
      }
    })();

    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
    };
  }, [user]);
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
}
