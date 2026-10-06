import { useEffect } from "react";
import { renewMemberSession } from "@/lib/member.functions";
import { renewMemberTokenIfDue } from "@/lib/member-renewal";

/** Same cadence as member-token.ts's expiry tick: a 30-day window needs no more. */
const CHECK_EVERY_MS = 60 * 60_000;

const renew = () => renewMemberSession();

/**
 * Renew this device's member token at load and hourly after, once it is inside
 * its last month. Mounted once, at the root, beside the account sync.
 *
 * The swap goes through refreshMemberToken rather than setMemberToken, so none
 * of the claim-time work (trophy carry, adoption hold, pack carry) runs again
 * for a person who never changed.
 */
export function useMemberTokenRenewal() {
  useEffect(() => {
    void renewMemberTokenIfDue(renew);
    const iv = window.setInterval(() => void renewMemberTokenIfDue(renew), CHECK_EVERY_MS);
    return () => window.clearInterval(iv);
  }, []);
}
