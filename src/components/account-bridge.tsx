import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAccountSync, useAuthUser } from "@/hooks/use-account";

/**
 * The app's single `onAuthStateChange` consumer, plus the token sync.
 *
 * Filtered to identity transitions on purpose: unfiltered it also fires on
 * TOKEN_REFRESHED (hourly, and on every tab focus) and INITIAL_SESSION (every
 * mount), which would thrash the router and the query cache for nothing.
 */
export function AccountBridge() {
  const { user } = useAuthUser();
  const router = useRouter();
  const queryClient = useQueryClient();

  useAccountSync(user);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      void router.invalidate();
      // Refetching on SIGNED_OUT would only hammer a cleared session.
      if (event !== "SIGNED_OUT") void queryClient.invalidateQueries();
    });
    return () => sub.subscription.unsubscribe();
  }, [router, queryClient]);

  return null;
}
