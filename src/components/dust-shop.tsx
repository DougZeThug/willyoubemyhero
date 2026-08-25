import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { dustBalanceKey } from "@/hooks/use-dust";
import { collectionTrophiesKey } from "@/hooks/use-collection-trophies";
import { editionStyle } from "@/lib/card-edition";
import { DUST_PRICES, MILL_LADDER, MILL_CLIENT_FLAT } from "@/lib/dust";
import { buyBonusSecretPull } from "@/lib/dust.functions";
import { mySecretsKey, secretStatusKey } from "@/hooks/use-daily-secret";
import { millCardCopy } from "@/lib/dust.functions";
import { getTradeSpares } from "@/lib/trades.functions";
import { millValue } from "@/lib/dust";
import { myCardStatsKey } from "@/hooks/use-my-collection";
import type { TradeSpares } from "@/lib/trades";

/**
 * What dust buys.
 *
 * Deliberately small: one thing to buy, and a table explaining where dust comes
 * from. The mill itself lives next to the spares on the trade screen, because
 * that is the only place a copy id exists to burn.
 *
 * NO TOTAL CROSSES THE WIRE HERE, the same rule the rest of the app keeps. The
 * prices are constants this bundle already holds, and the balance is the only
 * number fetched — nothing says how big the secret set is or what anybody else
 * has got.
 */
export function DustShop({
  open,
  onOpenChange,
  balance,
  participantId,
  actor,
  eventId,
  nameFor,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  balance: number | undefined;
  participantId: string | null | undefined;
  /**
   * `m:<participantId>`, the form the secret queries are keyed on.
   *
   * Taken as a prop rather than rebuilt here: the vault already holds it from
   * useSecretActor(), and a second place that knows how to spell an actor is a
   * second place that can spell it wrong — which is exactly what went wrong when
   * this invalidated on the bare participant id and matched nothing.
   */
  actor: string | null;
  eventId: string | null | undefined;
  /** `event_participants.id` → the name on the card. */
  nameFor: (eventParticipantId: string) => string;
}) {
  const qc = useQueryClient();
  const buyFn = useServerFn(buyBonusSecretPull);
  // One id per tap, held until that tap resolves. A lost response on a
  // 150-dust purchase is the worst bug this feature could ship, and the RPC
  // answers a repeat of the same id with the pull it already sold rather than a
  // second one. A fresh tap mints a fresh id, so buying twice still works.
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());

  const buy = useMutation({
    mutationFn: () => buyFn({ data: { requestId } }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast(
          res.reason === "insufficient"
            ? `Not enough dust yet — a pull is ${DUST_PRICES.bonusPull}`
            : "Nothing left in the pool right now",
        );
        return;
      }
      // The balance comes back on the response, so it is written straight in
      // rather than refetched — dust_ledger is not published to realtime and a
      // round trip here would show a stale number behind the ceremony.
      qc.setQueryData(dustBalanceKey(participantId), { balance: res.balance });
      // KEYED ON THE ACTOR, both of them. These two queries are registered as
      // ["daily-secret", "m:<uuid>"] and ["my-secrets", "m:<uuid>"], so a bare
      // participant id matches nothing at all and the purchase closed on "check
      // your secrets" with the card still missing. useMySecrets holds a
      // five-minute staleTime, so it was the one that stayed wrong longest.
      void qc.invalidateQueries({ queryKey: secretStatusKey(actor) });
      void qc.invalidateQueries({ queryKey: mySecretsKey(actor) });
      // A bought pull is a real pull: buy_bonus_secret_pull delegates to
      // pull_bonus_secret_card, which mints the row and awards the trophy. Buying
      // the card that finishes a set is the best moment this feature has, so the
      // shelf should not wait on a realtime event to notice.
      if (res.pull?.completedCollection) {
        void qc.invalidateQueries({ queryKey: collectionTrophiesKey() });
      }
      setRequestId(crypto.randomUUID());
      toast("Pull bought — check your secrets");
      onOpenChange(false);
    },
    onError: () => toast("Could not buy that just now"),
  });

  // Fetched only once the sheet is open. Nothing about the vault needs this, and
  // a spares query on every vault render would be a round trip for a panel most
  // visits never open.
  const sparesFn = useServerFn(getTradeSpares);
  const spares = useQuery({
    queryKey: ["dust-spares", participantId],
    queryFn: () => sparesFn({ data: { participantId: participantId! } }) as Promise<TradeSpares>,
    enabled: open && !!participantId,
    staleTime: 15_000,
    retry: false,
  });

  // Rarest first, so the biggest payout is the one at the top of the thumb.
  const burnable = useMemo(
    () =>
      [...(spares.data?.roster ?? [])].sort(
        (a, b) =>
          millValue(b.edition, b.assertedBy) - millValue(a.edition, a.assertedBy) ||
          nameFor(a.eventParticipantId).localeCompare(nameFor(b.eventParticipantId)),
      ),
    [spares.data, nameFor],
  );

  const millFn = useServerFn(millCardCopy);
  const [burning, setBurning] = useState<string | null>(null);
  const mill = useMutation({
    mutationFn: (cardCopyId: string) => millFn({ data: { cardCopyId } }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast(
          res.reason === "last_copy"
            ? "That is your only copy"
            : res.reason === "too_fresh"
              ? "Today's card — it can be burned tomorrow"
              : res.reason === "staked"
                ? "That one is on an open offer"
                : "Could not burn that one",
        );
        return;
      }
      qc.setQueryData(dustBalanceKey(participantId), { balance: res.balance });
      // The copy is gone, so both the spares list and the vault's own counts are
      // now wrong until they are asked again.
      void qc.invalidateQueries({ queryKey: ["dust-spares", participantId] });
      void qc.invalidateQueries({ queryKey: myCardStatsKey(eventId, participantId) });
      toast(`+${res.awarded} dust`);
    },
    onError: () => toast("Could not burn that one"),
    onSettled: () => setBurning(null),
  });

  const canAfford = (balance ?? 0) >= DUST_PRICES.bonusPull;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 font-display uppercase">
            <Sparkles className="h-5 w-5 text-primary" aria-hidden />
            Dust
          </SheetTitle>
          <SheetDescription>
            {balance == null ? "Counting…" : `You have ${balance.toLocaleString()}.`}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          <section className="rounded-lg border border-border p-4">
            <h3 className="font-display text-sm font-bold uppercase tracking-wide">
              Bonus secret pull
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              One extra pull, right now. It does not touch tomorrow&apos;s free one.
            </p>
            <Button
              className="mt-3 w-full"
              disabled={!canAfford || buy.isPending}
              onClick={() => buy.mutate()}
            >
              {buy.isPending ? "Pulling…" : `Buy for ${DUST_PRICES.bonusPull}`}
            </Button>
            {!canAfford && balance != null && (
              <p className="mt-2 text-center text-xs text-muted-foreground">
                {DUST_PRICES.bonusPull - balance} more to go
              </p>
            )}
          </section>

          <section className="rounded-lg border border-border p-4">
            <h3 className="font-display text-sm font-bold uppercase tracking-wide">Burn a spare</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Only cards you hold two or more of, and never the one you pulled today. You always
              keep one.
            </p>
            {spares.isLoading ? (
              <p className="mt-3 text-xs text-muted-foreground">Counting spares…</p>
            ) : burnable.length === 0 ? (
              <p className="mt-3 text-xs text-muted-foreground">No spares yet.</p>
            ) : (
              <ul className="mt-3 space-y-1.5">
                {burnable.map((r) => {
                  const style = editionStyle(r.edition);
                  const worth = millValue(r.edition, r.assertedBy);
                  return (
                    <li key={r.copyId} className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-xs">
                        <span className="font-bold">{nameFor(r.eventParticipantId)}</span>
                        {style.label && (
                          <span className="ml-1.5" style={{ color: style.accent }}>
                            {style.label}
                          </span>
                        )}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0"
                        disabled={mill.isPending}
                        onClick={() => {
                          setBurning(r.copyId);
                          mill.mutate(r.copyId);
                        }}
                      >
                        {burning === r.copyId && mill.isPending ? "…" : `Burn +${worth}`}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="rounded-lg border border-border p-4">
            <h3 className="font-display text-sm font-bold uppercase tracking-wide">
              Where dust comes from
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              A duplicate secret pays 25. Burning a spare pays by its finish:
            </p>
            <ul className="mt-3 space-y-1">
              {MILL_LADDER.map(({ edition, value }) => (
                <li key={edition} className="flex items-center justify-between text-xs">
                  <span style={{ color: editionStyle(edition).accent }}>
                    {editionStyle(edition).label}
                  </span>
                  <span className="font-mono">{value}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">
              Cards from before finishes were settled server-side pay a flat {MILL_CLIENT_FLAT}.
              Re-rolling one for {DUST_PRICES.reroll} settles it — and can send it either way.
            </p>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
