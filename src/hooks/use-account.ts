import { useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { syncAccountSession } from "@/lib/account.functions";
import { setMemberToken, clearMemberToken } from "@/lib/member-token";
import { setGuestToken, clearGuestToken } from "@/lib/guest-token";

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
      return;
    }
    if (syncedFor.current === user.id) return;
    syncedFor.current = user.id;

    void (async () => {
      try {
        const res = await syncAccountSession({ data: undefined });
        if (res.kind === "member") {
          clearGuestToken();
          setMemberToken(res.token, res.name ?? "Player");
        } else {
          clearMemberToken();
          setGuestToken(res.token);
        }
      } catch {
        // Signed in but unsynced simply behaves like the signed-out app: the
        // device keeps whatever identity it already had.
        syncedFor.current = null;
      }
    })();
  }, [user]);
}

/** Sign out, then leave the device with no borrowed identity. */
export async function signOutAccount() {
  await supabase.auth.signOut();
  clearMemberToken();
  clearGuestToken();
}
