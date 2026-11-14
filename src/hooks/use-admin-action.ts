import { useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";

/**
 * The shape every admin console button shares: busy while it runs, a success toast
 * when the work says what it did, and the server's own refusal text on failure.
 *
 * `work` returns the success line, or nothing when it has already said its piece
 * (or declined quietly). Throwing is the failure path; an Error's message is shown
 * as-is because the admin guards write theirs for a person, and `failure` is only
 * the fallback for anything that is not an Error.
 *
 * `key` is for a panel with one button per row: `busyKey` says which one is
 * running, `busy` says whether any is.
 */
export function useAdminAction() {
  const [busyKey, setBusyKey] = useState<string | null>(null);

  async function run(failure: string, work: () => Promise<string | void>, key = "") {
    setBusyKey(key);
    try {
      const done = await work();
      if (done) toast.success(done);
    } catch (e) {
      toast.error(errorMessage(e, failure));
    } finally {
      setBusyKey(null);
    }
  }

  return { busy: busyKey !== null, busyKey, run };
}
