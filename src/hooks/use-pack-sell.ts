import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { mySecretsKey } from "@/hooks/use-daily-secret";
import { packStatusKey } from "@/hooks/use-pack-status";
import { dustBalanceKey } from "@/hooks/use-dust";
import { dustSparesKey, tradeSparesKey } from "@/hooks/use-trades";
import { myCardStatsKey } from "@/hooks/use-my-collection";
import { cardPullCountsKey } from "@/hooks/use-card-pulls";
import { millCardCopy, sellSecretCard } from "@/lib/dust.functions";
import { getTradeSpares } from "@/lib/trades.functions";
import type { DustFailure } from "@/lib/dust-rows";
import type { PackSlot } from "@/lib/pack";
import type { Edition } from "@/lib/card-edition";

/** What the pack screen hears back: the dust it got, or one line to show inline. */
export type PackSellResult = { ok: true; awarded: number } | { ok: false; message: string };

/**
 * Said beside the button, never as a toast — the pack summary does not toast.
 * "Already gone" covers the replayed pack: open_pack hands back the same slots
 * all day, so a copy sold or traded an hour ago still has its "Sell for" here.
 */
const REFUSALS: Partial<Record<DustFailure, string>> = {
  not_yours: "Already gone — it left your vault",
  not_found: "Already gone — it left your vault",
  last_copy: "That's your last one",
  staked: "It's on an offer or up for sale",
  disabled: "Dust is switched off",
};
const FALLBACK = "Couldn't sell it — try again";
const REROLLED = "Its finish has changed — sell it from the Shop";

/**
 * Selling a card straight off the pack screen.
 *
 * The same two RPCs the dust shop calls, so every rule — ownership, the spare
 * rule, staked copies, the dust switch — is still Postgres's, under the
 * participant lock. What this adds is WHICH row:
 *
 * - A secret sells the very pull the pack dealt, by the `pullId` open_pack
 *   stored on the slot. It pays by that row's tier, which is the level on the
 *   card and the number the button quoted.
 * - A roster slot carries no copy id (open_pack mints through record_card_pulls
 *   and keeps only the finish), so this asks for the spares at the moment of
 *   the tap and burns the copy marked `pulledToday` — the one this pack minted,
 *   and there is only ever one per card per day. Not "any copy at this finish":
 *   the sold-receipts live in the route's state and a reload loses them, so a
 *   replayed slot would otherwise burn an older copy for every reload and
 *   confirm. Gone, it answers "already gone"; re-rolled since, it refuses too,
 *   because the button is quoting a finish that copy no longer has.
 *
 * A plain async call rather than useMutation, the useMilestoneClaim pattern: the
 * summary owns its pending state per dialog, and one hook serves three slots.
 */
export function usePackSell(
  actor: string | null,
  participantId: string | null | undefined,
  eventId: string | null | undefined,
) {
  const qc = useQueryClient();
  const millFn = useServerFn(millCardCopy);
  const sellFn = useServerFn(sellSecretCard);
  const sparesFn = useServerFn(getTradeSpares);

  /** The balance from the answer, and everything a copy leaving the vault moves. */
  const settle = useCallback(
    (balance: number) => {
      if (!participantId) return;
      qc.setQueryData(dustBalanceKey(participantId), { balance });
      // Both spares lists: the shop and the market read one key, the Trading
      // Post another, and a sold copy offered from either is a refused offer.
      void qc.invalidateQueries({ queryKey: dustSparesKey(participantId) });
      void qc.invalidateQueries({ queryKey: tradeSparesKey(participantId) });
      void qc.invalidateQueries({ queryKey: myCardStatsKey(eventId ?? null, participantId) });
      void qc.invalidateQueries({ queryKey: cardPullCountsKey(eventId ?? null) });
      // KEYED ON THE ACTOR, as the dust shop learned the hard way: these are
      // registered under "m:<uuid>" and a bare participant id matches nothing.
      void qc.invalidateQueries({ queryKey: mySecretsKey(actor) });
      void qc.invalidateQueries({ queryKey: packStatusKey(actor) });
    },
    [qc, actor, participantId, eventId],
  );

  return useCallback(
    async (slot: PackSlot, edition: Edition | null): Promise<PackSellResult> => {
      if (!participantId) return { ok: false, message: FALLBACK };
      try {
        if (slot.kind === "secret") {
          if (!slot.pullId) return { ok: false, message: FALLBACK };
          const res = await sellFn({ data: { secretPullId: slot.pullId } });
          if (!res.ok) return { ok: false, message: REFUSALS[res.reason] ?? FALLBACK };
          settle(res.balance);
          return { ok: true, awarded: res.awarded };
        }

        if (edition == null) return { ok: false, message: FALLBACK };
        const spares = await sparesFn({ data: { participantId } });
        const copy = spares.roster.find((c) => c.eventParticipantId === slot.id && c.pulledToday);
        if (!copy) return { ok: false, message: REFUSALS.not_yours ?? FALLBACK };
        if (copy.edition !== edition || copy.assertedBy !== "server") {
          return { ok: false, message: REROLLED };
        }
        const res = await millFn({ data: { cardCopyId: copy.copyId } });
        if (!res.ok) return { ok: false, message: REFUSALS[res.reason] ?? FALLBACK };
        settle(res.balance);
        return { ok: true, awarded: res.awarded };
      } catch {
        return { ok: false, message: FALLBACK };
      }
    },
    [participantId, sellFn, sparesFn, millFn, settle],
  );
}
