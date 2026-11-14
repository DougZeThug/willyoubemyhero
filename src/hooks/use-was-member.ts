import { useSyncExternalStore } from "react";
import { WAS_MEMBER_KEY } from "@/lib/member-token";

// Nothing in this tab writes the flag while a screen reading it is open; a read
// per render is enough.
const noSubscribe = () => () => {};

/**
 * Whether this phone has ever held a member token. Set on claim and never
 * cleared, so somebody arriving on a new phone is told where their cards went.
 * SSR has no localStorage, so the server snapshot is `false` and the client
 * re-reads after hydration rather than painting a mismatched first frame.
 */
export function useWasMember() {
  return useSyncExternalStore(
    noSubscribe,
    () => localStorage.getItem(WAS_MEMBER_KEY) === "1",
    () => false,
  );
}
