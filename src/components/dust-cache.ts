import { useQuery, type QueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  dustBalanceKey,
  dustSparesKey,
  myCardStatsKey,
  mySecretsKey,
  packStatusKey,
  tradeSparesKey,
} from "@/lib/query-keys";
import { getTradeSpares } from "@/lib/trades.functions";
import type { TradeSpares } from "@/lib/trades";

/** Whose phone this is: the participant, the event, and `m:<participantId>` for the secret queries. */
export type DustIds = {
  participantId: string | null | undefined;
  eventId: string | null | undefined;
  actor: string | null;
};

/**
 * Everything a dust transaction moves on the phone that made it.
 *
 * The balance is written straight in rather than refetched — dust_ledger is not
 * published to realtime, and a round trip would show a stale number behind the
 * ceremony. The spares come as a PAIR: the shop reads dustSparesKey and the
 * Trading Post reads tradeSparesKey for the same list, and naming only one left a
 * milled spare offerable for a cache lifetime, then refused by the server.
 *
 * `secrets` is the vault's shelf and the pack count beside it, KEYED ON THE ACTOR:
 * those queries register as ["my-secrets", "m:<uuid>"], so a bare participant id
 * matches nothing and fails silently. `stats` is the vault's per-card counts.
 */
export function settleDustMutation(
  qc: QueryClient,
  { participantId, eventId, actor }: DustIds,
  balance: number,
  { secrets = false, stats = false }: { secrets?: boolean; stats?: boolean } = {},
) {
  qc.setQueryData(dustBalanceKey(participantId), { balance });
  void qc.invalidateQueries({ queryKey: dustSparesKey(participantId) });
  void qc.invalidateQueries({ queryKey: tradeSparesKey(participantId) });
  if (stats) void qc.invalidateQueries({ queryKey: myCardStatsKey(eventId, participantId) });
  if (secrets) {
    void qc.invalidateQueries({ queryKey: mySecretsKey(actor) });
    void qc.invalidateQueries({ queryKey: packStatusKey(actor) });
  }
}

/** Your own spares, as the burn, sell and market sections all read them. */
export function useDustSpares(participantId: string | null | undefined, enabled = true) {
  const fn = useServerFn(getTradeSpares);
  return useQuery({
    queryKey: dustSparesKey(participantId),
    queryFn: () => fn({ data: { participantId: participantId! } }) as Promise<TradeSpares>,
    enabled: enabled && !!participantId,
    staleTime: 15_000,
    retry: false,
  });
}
