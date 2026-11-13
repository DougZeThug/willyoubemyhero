import { useQueryClient } from "@tanstack/react-query";
import { secretCardsKey } from "@/lib/query-keys";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";

/**
 * The secret-cards panel's one way to save: a loading/success/failure toast over
 * the write, and the list refetched before the toast settles. Resolves to whether
 * it worked and never rejects, because the toast has already told the commissioner
 * — callers only need to know whether to carry on (close a sheet, clear a field).
 */
export function useSecretSave() {
  const qc = useQueryClient();

  return async function save<T>(
    write: Promise<T>,
    opts: {
      /** A stable id replaces one toast instead of stacking one per keystroke. */
      id?: string;
      loading: string;
      success: string | ((result: T) => string);
      failure: string;
    },
  ): Promise<boolean> {
    const settled = write.then(async (r) => {
      await qc.invalidateQueries({ queryKey: secretCardsKey() });
      return r;
    });
    toast.promise(settled, {
      ...(opts.id ? { id: opts.id } : {}),
      loading: opts.loading,
      success: opts.success,
      error: (e) => errorMessage(e, opts.failure),
    });
    try {
      await settled;
      return true;
    } catch {
      return false;
    }
  };
}
