import {
  collectionTrophiesKey,
  dustBalanceKey,
  dustSparesKey,
  myCardStatsKey,
  mySecretsKey,
  packStatusKey,
  tradeSparesKey,
} from "@/lib/query-keys";
import { useId, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { editionStyle, toEdition } from "@/lib/card-edition";
import {
  DUST_PRICES,
  MILL_LADDER,
  MILL_CLIENT_FLAT,
  millValue,
  SECRET_SELL_LADDER,
  secretSellValue,
} from "@/lib/dust";
import { secretTierStyle, type SecretTier } from "@/lib/secret-rarity";
import { buyBonusSecretPull } from "@/lib/dust.functions";
import { getMySecrets } from "@/lib/secret-cards.functions";
import { BoughtPullReveal } from "@/components/bought-pull-reveal";
import { LevelPips } from "@/components/level-pips";
import { ListError } from "@/components/list-error";
import { ChevronDown } from "lucide-react";
import { SectionTitle } from "@/components/section-title";
import { ROW, ROW_LIST } from "@/components/shop-rows";
import { settleDustMutation, useDustSpares } from "@/hooks/use-dust-cache";
import { SetChip } from "@/components/set-chip";
import { PresentationMode } from "@/components/presentation-mode";
import { offlineReason, useIsOnline } from "@/hooks/use-online";
import type { OwnedSecret } from "@/lib/secret-cards";
import { memberIdentityOrNull } from "@/lib/identity";
import { cn } from "@/lib/utils";
import type { ImageUrlSet } from "@/lib/media";
import { millCardCopy, rerollCopyEdition, sellSecretCard } from "@/lib/dust.functions";

/**
 * A server from before 20260930120000 refuses today's pull with `too_fresh`.
 * Nothing newer returns it, but a phone can be ahead of the database it talks
 * to, and "Could not burn that one" reads like a bug rather than a rule.
 */
const TOO_FRESH = "Today's pull can be dusted from tomorrow";
const STAKED = "That one is on an open offer or up for sale";

const BUY_REFUSALS: Record<string, string> = {
  insufficient: `Not enough dust yet — a pull is ${DUST_PRICES.bonusPull}`,
};
const MILL_REFUSALS: Record<string, string> = {
  last_copy: "That is your only copy",
  staked: STAKED,
  too_fresh: TOO_FRESH,
};
const SELL_REFUSALS: Record<string, string> = { staked: STAKED, too_fresh: TOO_FRESH };
const REROLL_REFUSALS: Record<string, string> = {
  insufficient: `Not enough dust — a re-roll is ${DUST_PRICES.reroll}`,
  staked: STAKED,
};

/** Settle rows shown before "Show all". */
const SETTLE_CAP = 3;

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
  eventId,
  nameFor,
  backUrl = null,
}: {
  balance: number | undefined;
  participantId: string | null | undefined;
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
  const ids = { participantId, eventId };
  const actor = memberIdentityOrNull(participantId);
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
        toast(BUY_REFUSALS[res.reason] ?? "Nothing left in the pool right now");
        return;
      }
      // The balance comes back on the response, so it is written straight in
      // rather than refetched — dust_ledger is not published to realtime and a
      // round trip here would show a stale number behind the ceremony.
      settleDustMutation(qc, ids, res.balance, { secrets: true });
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

  const spares = useDustSpares(participantId);

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
    // The name rides along in the variables: the spares list is invalidated the
    // moment the copy goes, so looking it up in onSuccess would race the refetch.
    mutationFn: (v: { cardCopyId: string; name: string }) =>
      millFn({ data: { cardCopyId: v.cardCopyId } }),
    onSuccess: (res, v) => {
      if (!res.ok) {
        toast(MILL_REFUSALS[res.reason] ?? "Could not burn that one");
        return;
      }
      settleDustMutation(qc, ids, res.balance, { stats: true });
      toast(`Burned ${v.name} · +${res.awarded} dust`);
    },
    onError: () => toast("Could not burn that one"),
    onSettled: () => setBurning(null),
  });

  // `secrets` is already exactly the right subset — every copy you hold, today's
  // pull included, which is precisely what sell_secret_card accepts — so this
  // needs no query of its own. Copies of one card sit together so a duplicate
  // reads as one card held several times. Keyed by the card's id where the
  // server gave one (names are not unique), else by name. Groups order by their
  // best copy so the biggest payout is still at the top of the thumb.
  const sparesData = spares.data;
  const sellGroups = useMemo(() => {
    const byKey = new Map<string, NonNullable<typeof sparesData>["secrets"]>();
    for (const s of sparesData?.secrets ?? []) {
      const key = s.cardId ?? `name:${s.name}`;
      byKey.set(key, [...(byKey.get(key) ?? []), s]);
    }
    return [...byKey.entries()]
      .map(([key, copies]) => ({
        key,
        name: copies[0].name,
        copies: copies.sort(
          (a, b) =>
            secretSellValue(b.tier) - secretSellValue(a.tier) || a.pullId.localeCompare(b.pullId),
        ),
      }))
      .sort(
        (a, b) =>
          secretSellValue(b.copies[0].tier) - secretSellValue(a.copies[0].tier) ||
          a.name.localeCompare(b.name),
      );
  }, [sparesData]);
  // The badge counts copies, not names.
  const sellableCount = sellGroups.reduce((n, g) => n + g.copies.length, 0);

  const sellFn = useServerFn(sellSecretCard);
  const [selling, setSelling] = useState<string | null>(null);
  const sell = useMutation({
    mutationFn: (v: { secretPullId: string; name: string }) =>
      sellFn({ data: { secretPullId: v.secretPullId } }),
    onSuccess: (res, v) => {
      if (!res.ok) {
        toast(SELL_REFUSALS[res.reason] ?? "Could not sell that one");
        return;
      }
      settleDustMutation(qc, ids, res.balance, { secrets: true });
      toast(`Sold ${v.name} · +${res.awarded} dust`);
    },
    onError: () => toast("Could not sell that one"),
    onSettled: () => setSelling(null),
  });

  // Ids for the grouped copies' accessible description. Index-based, not name-based:
  // a name has spaces and colons, and aria-describedby is a space-separated list.
  const sellUid = useId();

  const sellButton = (
    s: { pullId: string; name: string; tier: SecretTier; lastCopy: boolean },
    describedBy?: string,
  ) => {
    const worth = secretSellValue(s.tier);
    return (
      <button
        type="button"
        className="neon-btn-quiet shrink-0"
        // Inside a group every button reads "Sell +N"; the card's name and this
        // copy's level are what tell a screen reader which is which. Not an
        // aria-label: that would replace the visible text the tests and the
        // e2e suite look the buttons up by.
        aria-describedby={describedBy}
        disabled={sell.isPending || offline}
        {...offlineReason(offline)}
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
          sell.mutate({ secretPullId: s.pullId, name: s.name });
        }}
      >
        {selling === s.pullId && sell.isPending ? "…" : `Sell +${worth}`}
      </button>
    );
  };

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
  const settleCapped = rerollable.length > SETTLE_CAP;

  const rerollFn = useServerFn(rerollCopyEdition);
  // Only the first few finishes show until asked. Local and keyed on nothing: a
  // refetch that shrinks the list simply stops rendering the button (see
  // `settleCapped`), so there is no stale flag to strand.
  const [showAllSettle, setShowAllSettle] = useState(false);
  const [rolling, setRolling] = useState<string | null>(null);
  // One id per tap, same rule as the purchase: the RPC answers a repeat with the
  // roll it already sold rather than charging twice for it.
  const [rerollIds, setRerollIds] = useState<Record<string, string>>({});
  const reroll = useMutation({
    mutationFn: (v: { copyId: string; name: string }) => {
      const copyId = v.copyId;
      const requestId = rerollIds[copyId] ?? crypto.randomUUID();
      setRerollIds((prev) => ({ ...prev, [copyId]: requestId }));
      return rerollFn({ data: { cardCopyId: copyId, requestId } });
    },
    onSuccess: (res, { copyId, name }) => {
      if (!res.ok) {
        toast(REROLL_REFUSALS[res.reason] ?? "Could not re-roll that one");
        return;
      }
      settleDustMutation(qc, ids, res.balance, { stats: true });
      // A fresh id, so the next tap on this card is a new gamble rather than a
      // replay of the one just paid for.
      setRerollIds((prev) => ({ ...prev, [copyId]: crypto.randomUUID() }));
      // Both ends, because it can go down — saying only the new one would read as
      // a win every time.
      toast(
        `${name}: ${editionStyle(toEdition(res.from)).label ?? "Standard"} → ${
          editionStyle(toEdition(res.to)).label ?? "Standard"
        }`,
      );
    },
    onError: () => toast("Could not re-roll that one"),
    onSettled: () => setRolling(null),
  });

  const canAfford = (balance ?? 0) >= DUST_PRICES.bonusPull;
  const canReroll = (balance ?? 0) >= DUST_PRICES.reroll;
  // Every button in this panel spends dust against a server. Offline they can
  // only fail, and a burn that looks like it went through is the worst of the
  // three ways this could read.
  const offline = !useIsOnline();

  return (
    <div className="space-y-section-gap">
      <section>
        <SectionTitle label="Bonus secret pull" />
        <button
          type="button"
          className="neon-btn neon-btn-hero mt-3 w-full"
          disabled={!canAfford || buy.isPending || offline}
          {...offlineReason(offline)}
          onClick={() => buy.mutate()}
        >
          {buy.isPending ? "Pulling…" : `Buy for ${DUST_PRICES.bonusPull}`}
        </button>
        {/* One line, not two: the shortfall (when there is one) and the one fact
            from the old intro worth keeping, that buying does not spend the free pull. */}
        <p className="mt-2 text-center text-meta text-muted-foreground">
          {!canAfford && balance != null
            ? `${DUST_PRICES.bonusPull - balance} more to go · doesn't touch tomorrow's free one`
            : "Doesn't touch tomorrow's free one."}
        </p>
      </section>

      <section>
        <SectionTitle label="Burn a spare" count={burnable.length || undefined} />
        <p className="text-meta text-muted-foreground">
          Spares only, today&apos;s pull included. You always keep one.
        </p>
        {spares.isLoading ? (
          <p className="mt-3 text-meta text-muted-foreground">Counting spares…</p>
        ) : spares.isError ? (
          <ListError what="your spares" onRetry={() => void spares.refetch()} />
        ) : burnable.length === 0 ? (
          <p className="mt-3 text-meta text-muted-foreground">No spares yet.</p>
        ) : (
          <ul className={cn(ROW_LIST, "mt-3")}>
            {burnable.map((r) => {
              const style = editionStyle(r.edition);
              const worth = millValue(r.edition, r.assertedBy);
              return (
                <li key={r.copyId} className={ROW}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-badge font-bold">
                      {nameFor(r.eventParticipantId)}
                    </span>
                    {style.label && (
                      <span className="mt-0.5 block text-meta" style={{ color: style.accent }}>
                        {style.label}
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    className="neon-btn-quiet shrink-0"
                    disabled={mill.isPending || offline}
                    {...offlineReason(offline)}
                    onClick={() => {
                      setBurning(r.copyId);
                      mill.mutate({ cardCopyId: r.copyId, name: nameFor(r.eventParticipantId) });
                    }}
                  >
                    {burning === r.copyId && mill.isPending ? "…" : `Burn +${worth}`}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <SectionTitle label="Sell a secret" count={sellableCount || undefined} />
        <p className="text-meta text-muted-foreground">
          Includes your only copy, and today&apos;s pull.
        </p>
        {spares.isLoading ? (
          <p className="mt-3 text-meta text-muted-foreground">Counting secrets…</p>
        ) : spares.isError ? (
          <ListError what="your secrets" onRetry={() => void spares.refetch()} />
        ) : sellableCount === 0 ? (
          <p className="mt-3 text-meta text-muted-foreground">No secrets yet.</p>
        ) : (
          <ul className={cn(ROW_LIST, "mt-3")}>
            {sellGroups.map((g, gi) => {
              if (g.copies.length === 1) {
                const s = g.copies[0];
                const style = secretTierStyle(s.tier);
                return (
                  // Wraps: name block and Sell are line one, the set chip is line two
                  // across the whole row, under the button too.
                  <li key={s.pullId} className={cn(ROW, "flex-wrap gap-y-1")}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-badge font-bold">{s.name}</span>
                      {/* Wraps rather than truncates: at 320 the level and "last copy"
                        run under the Sell button, and the one fact that must never
                        be cut is that this is the only copy. */}
                      <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-meta text-muted-foreground">
                        {/* The level decides what this is worth — the row's whole
                          point — so it gets the shape as well as the word. */}
                        <LevelPips tier={s.tier} />
                        <span style={{ color: style.accent }}>{style.label}</span>
                        {s.lastCopy && <span className="shrink-0">last copy</span>}
                      </span>
                    </span>
                    {sellButton(s)}
                    {/* Which set you would be selling it out of. Two secrets of the
                      same level are worth the same dust, so the set is the only
                      thing on this row that makes them different cards. Its own
                      full-width line: beside the Sell button "Cornhole Collection"
                      ellipsised at 320. Block (not the chip's inline-flex, where
                      truncate clips without an ellipsis) plus max-w-full keeps the
                      ellipsis as the safety net for a very long set name. */}
                    {/* Only when filed: an unfiled secret has no chip, and an empty
                      full-width line would still cost the row's gap-y. */}
                    {s.collection && (
                      <div className="min-w-0 basis-full">
                        <SetChip collection={s.collection} className="block w-fit max-w-full" />
                      </div>
                    )}
                  </li>
                );
              }
              // A duplicate: the name once, then a line per copy with its own price.
              // The set shows once under the name when every copy shares it, else on
              // each copy line, since the set is what tells two copies apart.
              const sharedSet = g.copies.every((c) => c.collection === g.copies[0].collection);
              const chip = (collection: string) => (
                <div className="min-w-0 basis-full">
                  <SetChip collection={collection} className="block w-fit max-w-full" />
                </div>
              );
              return (
                <li key={g.key} className="px-3 py-2">
                  <div className="flex min-h-6 items-center gap-2">
                    <span
                      id={`${sellUid}-n${gi}`}
                      className="block min-w-0 truncate text-badge font-bold"
                    >
                      {g.name}
                    </span>
                    <span className="shrink-0 rounded-full bg-white/10 px-1.5 text-meta text-muted-foreground">
                      ×{g.copies.length}
                    </span>
                  </div>
                  {sharedSet && g.copies[0].collection && chip(g.copies[0].collection)}
                  <ul className="divide-y divide-white/5">
                    {g.copies.map((s) => {
                      const style = secretTierStyle(s.tier);
                      return (
                        <li
                          key={s.pullId}
                          className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1"
                        >
                          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-meta text-muted-foreground">
                            <LevelPips tier={s.tier} />
                            <span id={`${sellUid}-l-${s.pullId}`} style={{ color: style.accent }}>
                              {style.label}
                            </span>
                            {s.lastCopy && <span className="shrink-0">last copy</span>}
                          </span>
                          {sellButton(s, `${sellUid}-n${gi} ${sellUid}-l-${s.pullId}`)}
                          {!sharedSet && s.collection && chip(s.collection)}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <SectionTitle label="Settle a finish" count={rerollable.length || undefined} />
        <p className="text-meta text-muted-foreground">
          Roll a card&apos;s finish again for {DUST_PRICES.reroll}. Any card, even your only one —
          and it can go down.
        </p>
        {/* Same voice as the bonus pull's "more to go": a row of dead buttons with no
            reason beside them reads as broken, not as short of dust. */}
        {rerollable.length > 0 && !canReroll && balance != null && (
          <p className="mt-2 text-meta text-muted-foreground">
            {DUST_PRICES.reroll - balance} more to re-roll
          </p>
        )}
        {spares.isLoading ? (
          <p className="mt-3 text-meta text-muted-foreground">Counting cards…</p>
        ) : spares.isError ? (
          <ListError what="your cards" onRetry={() => void spares.refetch()} />
        ) : rerollable.length === 0 ? (
          <p className="mt-3 text-meta text-muted-foreground">No cards yet.</p>
        ) : (
          <ul id="settle-list" className={cn(ROW_LIST, "mt-3")}>
            {(settleCapped && !showAllSettle ? rerollable.slice(0, SETTLE_CAP) : rerollable).map(
              (r) => {
                const style = editionStyle(r.edition);
                return (
                  <li key={r.copyId} className={ROW}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-badge font-bold">
                        {nameFor(r.eventParticipantId)}
                      </span>
                      {(style.label || r.assertedBy !== "server") && (
                        <span className="mt-0.5 flex items-center gap-1.5 text-meta text-muted-foreground">
                          {style.label && (
                            <span style={{ color: style.accent }}>{style.label}</span>
                          )}
                          {r.assertedBy !== "server" && <span>unsettled</span>}
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      className="neon-btn-quiet shrink-0"
                      disabled={!canReroll || reroll.isPending || offline}
                      {...offlineReason(offline)}
                      onClick={() => {
                        setRolling(r.copyId);
                        reroll.mutate({ copyId: r.copyId, name: nameFor(r.eventParticipantId) });
                      }}
                    >
                      {rolling === r.copyId && reroll.isPending
                        ? "…"
                        : `Re-roll ${DUST_PRICES.reroll}`}
                    </button>
                  </li>
                );
              },
            )}
          </ul>
        )}
        {settleCapped && !spares.isLoading && !spares.isError && (
          <button
            type="button"
            className="neon-btn-quiet mt-2 min-h-11 w-full"
            aria-expanded={showAllSettle}
            aria-controls="settle-list"
            onClick={() => setShowAllSettle((v) => !v)}
          >
            {showAllSettle ? "Show less" : `Show all ${rerollable.length}`}
          </button>
        )}
      </section>

      <section>
        {/* Reference, not an action: closed until asked for. The h2 lives inside the
            summary so the heading role (and the e2e's name lookup) survives. */}
        <details className="group">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-primary [&::-webkit-details-marker]:hidden">
            <h2 className="font-display text-badge font-bold uppercase tracking-[0.08em]">
              Where dust comes from
            </h2>
            <ChevronDown
              aria-hidden
              className="h-4 w-4 transition-transform group-open:rotate-180"
            />
          </summary>
          {/* The one panel on this screen that is a table rather than a list of
            actions, and the only place the rarity ladder is written down
            anywhere in the app. */}
          <div
            className={cn(
              "surface-panel mt-3 grid rounded-xl border p-3",
              // Under 380px a 50/50 split leaves the level column ~119px for pips,
              // "Legendary" and "120", which does not fit; the finish column is
              // short, so it takes its content and the level column gets the rest.
              "grid-cols-[auto_minmax(0,1fr)] gap-x-4 min-[380px]:grid-cols-2 min-[380px]:gap-x-6",
            )}
          >
            <ul className="space-y-1">
              {MILL_LADDER.map(({ edition, value }) => (
                <li key={edition} className="flex items-center justify-between gap-2 text-meta">
                  <span style={{ color: editionStyle(edition).accent }}>
                    {editionStyle(edition).label}
                  </span>
                  <span className="font-mono">{value}</span>
                </li>
              ))}
            </ul>
            <ul className="space-y-1">
              {SECRET_SELL_LADDER.map(({ tier, value }) => (
                <li key={tier} className="flex items-center justify-between gap-2 text-meta">
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <LevelPips tier={tier} />
                    <span style={{ color: secretTierStyle(tier).accent }}>
                      {secretTierStyle(tier).label}
                    </span>
                  </span>
                  <span className="font-mono">{value}</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="mt-3 text-meta text-muted-foreground">
            Cards from before finishes were settled server-side pay a flat {MILL_CLIENT_FLAT},
            whatever they say on them. Settling one above fixes that.
          </p>
        </details>
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
