import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { dustBalanceKey } from "@/hooks/use-dust";
import { collectionTrophiesKey } from "@/hooks/use-collection-trophies";
import { editionStyle, toEdition } from "@/lib/card-edition";
import {
  DUST_PRICES,
  MILL_LADDER,
  MILL_CLIENT_FLAT,
  millValue,
  SECRET_SELL_LADDER,
  secretSellValue,
} from "@/lib/dust";
import { secretTierStyle } from "@/lib/secret-rarity";
import { buyBonusSecretPull } from "@/lib/dust.functions";
import { getMySecrets } from "@/lib/secret-cards.functions";
import { BoughtPullReveal } from "@/components/bought-pull-reveal";
import { PresentationMode } from "@/components/presentation-mode";
import type { OwnedSecret } from "@/lib/secret-cards";
import type { ImageUrlSet } from "@/lib/media";
import { mySecretsKey, secretStatusKey } from "@/hooks/use-daily-secret";
import { millCardCopy, rerollCopyEdition, sellSecretCard } from "@/lib/dust.functions";
import { getTradeSpares } from "@/lib/trades.functions";
import { tradeSparesKey } from "@/hooks/use-trades";
import { myCardStatsKey } from "@/hooks/use-my-collection";
import type { TradeSpares } from "@/lib/trades";

/**
 * What dust buys, and what it is made of.
 *
 * Four sections and a price table: a bonus pull, the mill, the secret counter,
 * and a re-roll. This was a sheet behind the vault's dust chip until it grew all
 * of them, which is a screen — /players/shop renders it now, and gets a nav tab
 * whenever the commissioner has the economy switched on.
 *
 * Still a prop-driven panel rather than the route itself. Everything below is
 * cache bookkeeping whose keys are spelled somewhere else, and getting one wrong
 * fails silently — the mutation succeeds, the toast fires, and the screen keeps
 * showing the old world. dust-shop.test.tsx pins every one of those keys, and it
 * can only do that against something that takes its data as arguments.
 *
 * NO TOTAL CROSSES THE WIRE HERE, the same rule the rest of the app keeps. The
 * prices are constants this bundle already holds, and the balance is the only
 * number fetched — nothing says how big the secret set is or what anybody else
 * has got.
 */
export function DustShopPanel({
  balance,
  participantId,
  actor,
  eventId,
  nameFor,
  backUrl = null,
}: {
  balance: number | undefined;
  participantId: string | null | undefined;
  /**
   * `m:<participantId>`, the form the secret queries are keyed on.
   *
   * Taken as a prop rather than rebuilt here: the route already holds it from
   * useSecretActor(), and a second place that knows how to spell an actor is a
   * second place that can spell it wrong — which is exactly what went wrong when
   * this invalidated on the bare participant id and matched nothing.
   */
  actor: string | null;
  eventId: string | null | undefined;
  /** `event_participants.id` → the name on the card. */
  nameFor: (eventParticipantId: string) => string;
  /**
   * The event's universal card back, for the reveal a purchase ends on. Taken as
   * a prop rather than fetched: the route already holds it, and secrets carry no
   * back of their own — without it the turn lands on a text placeholder.
   */
  backUrl?: ImageUrlSet | string | null;
}) {
  const qc = useQueryClient();
  const buyFn = useServerFn(buyBonusSecretPull);
  const mySecretsFn = useServerFn(getMySecrets);
  /**
   * The card a purchase just bought, held until it has been looked at.
   *
   * A 150-dust pull used to close on "check your secrets", which meant going
   * hunting through the vault to work out which card was new. It is the only way
   * of getting a secret that never showed you one.
   */
  const [bought, setBought] = useState<{ card: OwnedSecret; duplicate: boolean } | null>(null);
  /** A completed set celebrates AFTER the card, never behind it. */
  const [trophyPending, setTrophyPending] = useState(false);
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
      const completed = !!res.pull?.completedCollection;
      setTrophyPending(completed);
      setRequestId(crypto.randomUUID());

      // The purchase names the card it bought but not its face, so the shelf is
      // asked once, directly, and the answer is written into the cache the vault
      // reads. The trophy waits for the reveal to close: two ceremonies at once
      // is one ceremony nobody sees.
      const cardId = res.pull?.cardId ?? null;
      void (async () => {
        try {
          const fresh = (await mySecretsFn()) as { cards: OwnedSecret[]; pulled: number };
          qc.setQueryData(mySecretsKey(actor), fresh);
          const card = fresh.cards.find((c) => c.id === cardId) ?? null;
          if (card) {
            setBought({ card, duplicate: !!res.pull?.duplicate });
            return;
          }
          throw new Error("card missing from the shelf");
        } catch {
          // Offline mid-purchase, or a shelf that came back without it. The card
          // is minted either way, so this falls back rather than getting stuck.
          if (completed) {
            void qc.invalidateQueries({ queryKey: collectionTrophiesKey() });
            setTrophyPending(false);
          }
          toast("Pull bought — check your secrets");
        }
      })();
    },
    onError: () => toast("Could not buy that just now"),
  });

  const sparesFn = useServerFn(getTradeSpares);
  const spares = useQuery({
    queryKey: ["dust-spares", participantId],
    queryFn: () => sparesFn({ data: { participantId: participantId! } }) as Promise<TradeSpares>,
    // This used to wait on the sheet being open. Being on the screen is that
    // intent now, so the only gate left is having somebody to ask about.
    enabled: !!participantId,
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
                ? "That one is on an open offer or up for sale"
                : "Could not burn that one",
        );
        return;
      }
      qc.setQueryData(dustBalanceKey(participantId), { balance: res.balance });
      // The copy is gone, so both the spares list and the vault's own counts are
      // now wrong until they are asked again.
      void qc.invalidateQueries({ queryKey: ["dust-spares", participantId] });
      // The trading post reads a DIFFERENT key for the same list. Without
      // this a milled spare stayed offerable for up to a cache lifetime, and
      // the server refused the offer that was composed from it. market-panel
      // next door already invalidated both.
      void qc.invalidateQueries({ queryKey: tradeSparesKey(participantId) });
      void qc.invalidateQueries({ queryKey: myCardStatsKey(eventId, participantId) });
      toast(`+${res.awarded} dust`);
    },
    onError: () => toast("Could not burn that one"),
    onSettled: () => setBurning(null),
  });

  // Sorted the way `burnable` is: biggest payout at the top of the thumb, name as
  // the tiebreak. `secrets` is already exactly the right subset — getTradeSpares
  // filters out today's un-granted pull, which is precisely what sell_secret_card
  // refuses — so this needs no query of its own.
  const sellable = useMemo(
    () =>
      [...(spares.data?.secrets ?? [])].sort(
        (a, b) => secretSellValue(b.tier) - secretSellValue(a.tier) || a.name.localeCompare(b.name),
      ),
    [spares.data],
  );

  const sellFn = useServerFn(sellSecretCard);
  const [selling, setSelling] = useState<string | null>(null);
  const sell = useMutation({
    mutationFn: (secretPullId: string) => sellFn({ data: { secretPullId } }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast(
          res.reason === "too_fresh"
            ? "Today's pull — it can be sold tomorrow"
            : res.reason === "staked"
              ? "That one is on an open offer or up for sale"
              : "Could not sell that one",
        );
        return;
      }
      qc.setQueryData(dustBalanceKey(participantId), { balance: res.balance });
      void qc.invalidateQueries({ queryKey: ["dust-spares", participantId] });
      // The trading post reads a DIFFERENT key for the same list. Without
      // this a milled spare stayed offerable for up to a cache lifetime, and
      // the server refused the offer that was composed from it. market-panel
      // next door already invalidated both.
      void qc.invalidateQueries({ queryKey: tradeSparesKey(participantId) });
      // KEYED ON THE ACTOR, both of them — the vault's secret shelf and the count
      // beside it have both moved, and a bare participant id matches neither. See
      // the comment on the prop.
      void qc.invalidateQueries({ queryKey: mySecretsKey(actor) });
      void qc.invalidateQueries({ queryKey: secretStatusKey(actor) });
      toast(`+${res.awarded} dust`);
    },
    onError: () => toast("Could not sell that one"),
    onSettled: () => setSelling(null),
  });

  // Every copy, not just the spares: reroll_copy_edition has no spare rule, and a
  // card you hold once is the one most worth settling. Unsettled finishes lead,
  // because that is what the section is for.
  const rerollable = useMemo(
    () =>
      [...(spares.data?.ownedRoster ?? [])].sort(
        (a, b) =>
          Number(a.assertedBy === "server") - Number(b.assertedBy === "server") ||
          nameFor(a.eventParticipantId).localeCompare(nameFor(b.eventParticipantId)),
      ),
    [spares.data, nameFor],
  );

  const rerollFn = useServerFn(rerollCopyEdition);
  const [rolling, setRolling] = useState<string | null>(null);
  // One id per tap, same rule as the purchase: the RPC answers a repeat with the
  // roll it already sold rather than charging twice for it.
  const [rerollIds, setRerollIds] = useState<Record<string, string>>({});
  const reroll = useMutation({
    mutationFn: (copyId: string) => {
      const requestId = rerollIds[copyId] ?? crypto.randomUUID();
      setRerollIds((prev) => ({ ...prev, [copyId]: requestId }));
      return rerollFn({ data: { cardCopyId: copyId, requestId } });
    },
    onSuccess: (res, copyId) => {
      if (!res.ok) {
        toast(
          res.reason === "insufficient"
            ? `Not enough dust — a re-roll is ${DUST_PRICES.reroll}`
            : res.reason === "staked"
              ? "That one is on an open offer or up for sale"
              : "Could not re-roll that one",
        );
        return;
      }
      qc.setQueryData(dustBalanceKey(participantId), { balance: res.balance });
      void qc.invalidateQueries({ queryKey: ["dust-spares", participantId] });
      // The trading post reads a DIFFERENT key for the same list. Without
      // this a milled spare stayed offerable for up to a cache lifetime, and
      // the server refused the offer that was composed from it. market-panel
      // next door already invalidated both.
      void qc.invalidateQueries({ queryKey: tradeSparesKey(participantId) });
      void qc.invalidateQueries({ queryKey: myCardStatsKey(eventId, participantId) });
      // A fresh id, so the next tap on this card is a new gamble rather than a
      // replay of the one just paid for.
      setRerollIds((prev) => ({ ...prev, [copyId]: crypto.randomUUID() }));
      // Both ends, because it can go down — saying only the new one would read as
      // a win every time.
      toast(
        `${editionStyle(toEdition(res.from)).label ?? "Standard"} → ${
          editionStyle(toEdition(res.to)).label ?? "Standard"
        }`,
      );
    },
    onError: () => toast("Could not re-roll that one"),
    onSettled: () => setRolling(null),
  });

  const canAfford = (balance ?? 0) >= DUST_PRICES.bonusPull;
  const canReroll = (balance ?? 0) >= DUST_PRICES.reroll;

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-border p-4">
        <h2 className="font-display text-sm font-bold uppercase tracking-wide">
          Bonus secret pull
        </h2>
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
        <h2 className="font-display text-sm font-bold uppercase tracking-wide">Burn a spare</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Only cards you hold two or more of, and never the one you pulled today. You always keep
          one.
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
                    variant="outline"
                    className="min-h-11 shrink-0"
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
        <h2 className="font-display text-sm font-bold uppercase tracking-wide">Sell a secret</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Any secret you hold, priced by the level on your copy — including your only one. Never the
          one you pulled today.
        </p>
        {spares.isLoading ? (
          <p className="mt-3 text-xs text-muted-foreground">Counting secrets…</p>
        ) : sellable.length === 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">No secrets yet.</p>
        ) : (
          <ul className="mt-3 space-y-1.5">
            {sellable.map((s) => {
              const style = secretTierStyle(s.tier);
              const worth = secretSellValue(s.tier);
              return (
                <li key={s.pullId} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-xs">
                    <span className="font-bold">{s.name}</span>
                    <span className="ml-1.5" style={{ color: style.accent }}>
                      {style.label}
                    </span>
                    {s.lastCopy && <span className="ml-1.5 text-muted-foreground">last copy</span>}
                  </span>
                  <Button
                    variant="outline"
                    className="min-h-11 shrink-0"
                    disabled={sell.isPending}
                    onClick={() => {
                      // The card genuinely leaves the collection when it is the
                      // only one, which is what `lastCopy` is carried for. Same
                      // shape as the confirm in dust-admin-panel.tsx.
                      if (
                        s.lastCopy &&
                        !confirm(`Sell your only ${s.name} for ${worth}? It leaves your vault.`)
                      ) {
                        return;
                      }
                      setSelling(s.pullId);
                      sell.mutate(s.pullId);
                    }}
                  >
                    {selling === s.pullId && sell.isPending ? "…" : `Sell +${worth}`}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-border p-4">
        <h2 className="font-display text-sm font-bold uppercase tracking-wide">Settle a finish</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Roll a card&apos;s finish again for {DUST_PRICES.reroll}. Any card you hold, including
          your only one — and it can go down.
        </p>
        {spares.isLoading ? (
          <p className="mt-3 text-xs text-muted-foreground">Counting cards…</p>
        ) : rerollable.length === 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">No cards yet.</p>
        ) : (
          <ul className="mt-3 space-y-1.5">
            {rerollable.map((r) => {
              const style = editionStyle(r.edition);
              return (
                <li key={r.copyId} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-xs">
                    <span className="font-bold">{nameFor(r.eventParticipantId)}</span>
                    {style.label && (
                      <span className="ml-1.5" style={{ color: style.accent }}>
                        {style.label}
                      </span>
                    )}
                    {r.assertedBy !== "server" && (
                      <span className="ml-1.5 text-muted-foreground">unsettled</span>
                    )}
                  </span>
                  <Button
                    variant="outline"
                    className="min-h-11 shrink-0"
                    disabled={!canReroll || reroll.isPending}
                    onClick={() => {
                      setRolling(r.copyId);
                      reroll.mutate(r.copyId);
                    }}
                  >
                    {rolling === r.copyId && reroll.isPending
                      ? "…"
                      : `Re-roll ${DUST_PRICES.reroll}`}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-border p-4">
        <h2 className="font-display text-sm font-bold uppercase tracking-wide">
          Where dust comes from
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Burning a spare pays by its finish, and selling a secret pays by its level:
        </p>
        <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1">
          <ul className="space-y-1">
            {MILL_LADDER.map(({ edition, value }) => (
              <li key={edition} className="flex items-center justify-between text-xs">
                <span style={{ color: editionStyle(edition).accent }}>
                  {editionStyle(edition).label}
                </span>
                <span className="font-mono">{value}</span>
              </li>
            ))}
          </ul>
          <ul className="space-y-1">
            {SECRET_SELL_LADDER.map(({ tier, value }) => (
              <li key={tier} className="flex items-center justify-between text-xs">
                <span style={{ color: secretTierStyle(tier).accent }}>
                  {secretTierStyle(tier).label}
                </span>
                <span className="font-mono">{value}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Cards from before finishes were settled server-side pay a flat {MILL_CLIENT_FLAT},
          whatever they say on them. Settling one above fixes that.
        </p>
      </section>

      {/* While the reveal owns the screen the nav behind it goes inert —
          otherwise Tab reaches straight through the overlay to the chrome. */}
      {bought && <PresentationMode active />}
      {bought && (
        <BoughtPullReveal
          card={bought.card}
          duplicate={bought.duplicate}
          universalBack={backUrl}
          onDone={() => {
            setBought(null);
            if (trophyPending) {
              void qc.invalidateQueries({ queryKey: collectionTrophiesKey() });
              setTrophyPending(false);
            }
          }}
        />
      )}
    </div>
  );
}
