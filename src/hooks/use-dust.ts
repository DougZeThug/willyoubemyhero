import { dustBalanceKey } from "./query-keys";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getDustBalance } from "@/lib/dust.functions";

/**
 * What you have to spend.
 *
 * No realtime subscription, for the reason `dust_ledger` is not published at all:
 * a broadcast would give every connected phone a live feed of what everybody is
 * spending. Nothing else needs one either — the balance only moves on this
 * device's own actions, and every one of them answers with the new number, so the
 * mutations write it straight into this cache rather than waiting for a refetch.
 *
 * Members only. A guest has no ledger, so this stays disabled rather than asking
 * and being refused.
 */
export function useDustBalance(participantId: string | null | undefined) {
  const fn = useServerFn(getDustBalance);
  return useQuery({
    queryKey: dustBalanceKey(participantId),
    queryFn: () => fn() as Promise<{ balance: number }>,
    enabled: !!participantId,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    // A token that expired mid-party should show no chip at all rather than
    // retry three times behind a spinner on a screen somebody is using.
    retry: false,
  });
}
