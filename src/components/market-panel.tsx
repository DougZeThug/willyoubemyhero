import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { TradeItemTile, type RosterCardLookup } from "@/components/trade-offer-card";
import { dustBalanceKey } from "@/hooks/use-dust";
import { marketListingsKey, myStallKey, useMarketListings, useMyStall } from "@/hooks/use-market";
import { mySecretsKey, secretStatusKey } from "@/hooks/use-daily-secret";
import { myCardStatsKey } from "@/hooks/use-my-collection";
import { cardPullCountsKey } from "@/hooks/use-card-pulls";
import { collectionTrophiesKey } from "@/hooks/use-collection-trophies";
import { tradeSparesKey } from "@/hooks/use-trades";
import { editionLabel, editionStyle, toEdition } from "@/lib/card-edition";
import { secretTierStyle } from "@/lib/secret-rarity";
import { houseFloor, marketStatusLabel, MARKET_PRICE_MAX, MARKET_PRICE_MIN } from "@/lib/market";
import type { MarketListing, MarketListingItem, MyMarketListing } from "@/lib/market";
import { buyMarketListing, cancelMarketListing, listCardForDust } from "@/lib/market.functions";
import { getTradeSpares } from "@/lib/trades.functions";
import type { ImageUrlSet } from "@/lib/media";
import type { TradeItemView, TradeSpares } from "@/lib/trades";

/**
 * The marketplace: a spare priced by the person selling it.
 *
 * Its own panel rather than a sixth section inside DustShopPanel, for the reason
 * that file's header gives about itself — everything below is cache bookkeeping
 * whose keys are spelled somewhere else, getting one wrong fails silently, and
 * market-panel.test.tsx can only pin them against something that takes its data
 * as arguments.
 *
 * TWO SECTIONS, and they are deliberately different shapes. The shelf is a tile
 * grid because you are buying a PICTURE — a card's finish and its art are most of
 * what a price is for. Your own stall is rows, matching the burn and sell lists
 * next door, because there you already know what you own and the numbers are the
 * point.
 *
 * NO TOTAL CROSSES THE WIRE HERE either. The shelf is a list; its length is its
 * own length. Nothing says how big the secret set is or what anybody else holds
 * beyond what they have chosen to put up for sale.
 */
export type MarketPanelProps = {
  balance: number | undefined;
  participantId: string;
  /** `m:<participantId>` — the secret queries key on this, never the bare id. */
  actor: string | null;
  eventId: string | null | undefined;
  nameFor: (eventParticipantId: string) => string;
  nameOf: (participantId: string) => string;
  lookup: RosterCardLookup;
  /** The event's universal back, for a concealed tile. */
  backUrl: ImageUrlSet | string | null;
  /**
   * The commissioner's switch. False renders the STALL ALONE — no shelf, no
   * listing flow — and nothing at all if there is nothing on it.
   *
   * Not simply "hide the whole panel", which is what this did and what made
   * `cancel_market_listing`'s promise a lie. That RPC is the one in the feature
   * deliberately built without a dust_enabled() gate, precisely so switching the
   * economy off mid-party cannot strand somebody's cards on a shelf they can no
   * longer reach — and the screen has to offer the way back for that to mean
   * anything.
   */
  dustOn: boolean;
};

/**
 * A listing as TradeItemTile wants it.
 *
 * The tile keys on `copyId` / `pullId`, and a market listing deliberately carries
 * neither — the listing id is the only handle that crosses the wire, precisely so
 * browsing does not hand every member a stable reference to everybody else's rows.
 * So the LISTING id stands in: the tile uses it as a React key and nothing else,
 * and it is already the id every action on this screen names.
 */
function asTileItem(listing: MarketListing): TradeItemView {
  return listing.item.kind === "roster"
    ? {
        kind: "roster",
        copyId: listing.id,
        eventParticipantId: listing.item.eventParticipantId,
        edition: listing.item.edition,
      }
    : {
        kind: "secret",
        pullId: listing.id,
        name: listing.item.name,
        artUrl: listing.item.artUrl,
        tier: listing.item.tier,
        // A shelf says nothing about how many of a card its seller has left. That
        // is their collection, not part of the price.
        lastCopy: false,
      };
}

/** "Gold" / "Mythic" — the one word under a tile that is not the name. */
function itemMeta(item: MarketListingItem): { label: string | null; accent: string } {
  if (item.kind === "roster") {
    const style = editionStyle(item.edition);
    // "unsettled" is the shop's word for a finish Postgres did not decide, and
    // it belongs beside the price: a client-asserted platinum mills for the flat
    // floor, so a buyer reading "Platinum" alone was paying for the word.
    // editionLabel is null for standard, which every adopted copy now is, so
    // the two halves are joined rather than templated.
    const label =
      item.assertedBy === "client"
        ? [editionLabel(item.edition), "unsettled"].filter(Boolean).join(" · ")
        : editionLabel(item.edition);
    return { label, accent: style.accent };
  }
  const style = secretTierStyle(item.tier);
  return { label: style.label, accent: style.accent };
}

export function MarketPanel({
  balance,
  participantId,
  actor,
  eventId,
  nameFor,
  nameOf,
  lookup,
  backUrl,
  dustOn,
}: MarketPanelProps) {
  const qc = useQueryClient();
  // The shelf is unreachable while the switch is off — every buy would answer
  // `disabled` — so it is not asked for. The stall is, because taking a listing
  // down still works.
  const market = useMarketListings(dustOn ? participantId : null);
  const stall = useMyStall(participantId);

  const buyFn = useServerFn(buyMarketListing);
  const listFn = useServerFn(listCardForDust);
  const cancelFn = useServerFn(cancelMarketListing);
  const sparesFn = useServerFn(getTradeSpares);

  /** The same list the burn and sell sections read — your own spares. */
  const spares = useQuery({
    queryKey: ["dust-spares", participantId],
    queryFn: () => sparesFn({ data: { participantId } }) as Promise<TradeSpares>,
    enabled: dustOn && !!participantId,
    staleTime: 15_000,
    retry: false,
  });

  const [buying, setBuying] = useState<string | null>(null);
  const [pulling, setPulling] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [staged, setStaged] = useState<{ item: TradeItemView; floor: number } | null>(null);
  const [price, setPrice] = useState("");
  /**
   * One id per BUY tap, reused if that tap is retried and rotated on success.
   * A lost response on a purchase is the worst bug this feature could ship, and
   * the listing's own status cannot key it — a retry finds it already sold, to
   * this very caller. Keyed per listing so two buys in a row are two purchases.
   */
  const [requestIds, setRequestIds] = useState<Record<string, string>>({});

  function requestIdFor(listingId: string) {
    const existing = requestIds[listingId];
    if (existing) return existing;
    const next = crypto.randomUUID();
    setRequestIds((prev) => ({ ...prev, [listingId]: next }));
    return next;
  }

  /**
   * Everything a sale moves, on the buyer's phone.
   *
   * The actor-keyed secret invalidations are the trap dust-shop.tsx carries a live
   * comment about: those queries register as ["daily-secret", "m:<uuid>"], so a
   * bare participant id here would match nothing and fail silently.
   */
  function refreshAfterBuy(completedCollection: unknown) {
    void qc.invalidateQueries({ queryKey: marketListingsKey(participantId) });
    void qc.invalidateQueries({ queryKey: myStallKey(participantId) });
    void qc.invalidateQueries({ queryKey: ["dust-spares", participantId] });
    void qc.invalidateQueries({ queryKey: tradeSparesKey(participantId) });
    void qc.invalidateQueries({ queryKey: myCardStatsKey(eventId, participantId) });
    // A buyer who held none of that card now holds one, so the public "Packed by
    // N" has genuinely risen — the same reason a completed trade invalidates it.
    void qc.invalidateQueries({ queryKey: cardPullCountsKey(eventId) });
    void qc.invalidateQueries({ queryKey: mySecretsKey(actor) });
    void qc.invalidateQueries({ queryKey: secretStatusKey(actor) });
    if (completedCollection) void qc.invalidateQueries({ queryKey: collectionTrophiesKey() });
  }

  const buy = useMutation({
    mutationFn: (listing: MarketListing) =>
      buyFn({ data: { listingId: listing.id, requestId: requestIdFor(listing.id) } }),
    onSuccess: (res, listing) => {
      if (!res.ok) {
        toast(BUY_REFUSALS[res.reason] ?? "Could not buy that just now");
        // A refused buy still changed the world when the reason was `resolved` or
        // `voided` — the shelf is stale either way, so it is worth a refresh.
        void qc.invalidateQueries({ queryKey: marketListingsKey(participantId) });
        return;
      }
      // Written straight in rather than refetched: the response already carries
      // the new balance, and a refetch would race the invalidations below.
      qc.setQueryData(dustBalanceKey(participantId), { balance: res.balance });
      refreshAfterBuy(res.completedCollection);
      setRequestIds((prev) => {
        const { [listing.id]: _spent, ...rest } = prev;
        return rest;
      });
      toast(
        listing.item.kind === "roster"
          ? `${nameFor(listing.item.eventParticipantId)} is yours — ${res.price} dust`
          : `Bought for ${res.price} dust — check your secrets`,
      );
    },
    onError: () => toast("Could not buy that just now"),
    onSettled: () => setBuying(null),
  });

  const putUp = useMutation({
    mutationFn: (args: { item: TradeItemView; price: number }) =>
      listFn({
        data:
          args.item.kind === "roster"
            ? { kind: "roster" as const, copyId: args.item.copyId, price: args.price }
            : { kind: "secret" as const, pullId: args.item.pullId, price: args.price },
      }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast(LIST_REFUSALS[res.reason] ?? "Could not list that one");
        return;
      }
      void qc.invalidateQueries({ queryKey: myStallKey(participantId) });
      void qc.invalidateQueries({ queryKey: ["dust-spares", participantId] });
      setPicking(false);
      setStaged(null);
      setPrice("");
      toast(`Up for ${res.price} dust`);
    },
    onError: () => toast("Could not list that one"),
  });

  const pull = useMutation({
    mutationFn: (listingId: string) => cancelFn({ data: { listingId } }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: myStallKey(participantId) });
      void qc.invalidateQueries({ queryKey: ["dust-spares", participantId] });
      if (!res.ok) {
        toast(res.reason === "resolved" ? "Somebody already bought that one" : "Could not pull it");
        return;
      }
      toast("Taken off the market");
    },
    onError: () => toast("Could not pull it"),
    onSettled: () => setPulling(null),
  });

  const listings = market.data?.listings ?? [];
  const active = stall.data?.active ?? [];
  const recent = stall.data?.recent ?? [];

  /** Your spares, as tiles the picker can stage. */
  const sellable: { item: TradeItemView; floor: number }[] = useMemo(() => {
    const data = spares.data;
    if (!data) return [];
    return [
      ...data.roster.map((r) => ({
        item: {
          kind: "roster" as const,
          copyId: r.copyId,
          eventParticipantId: r.eventParticipantId,
          edition: toEdition(r.edition),
        },
        floor: houseFloor({
          kind: "roster",
          eventParticipantId: r.eventParticipantId,
          edition: toEdition(r.edition),
          assertedBy: r.assertedBy,
        }),
      })),
      ...data.secrets.map((s) => ({
        item: {
          kind: "secret" as const,
          pullId: s.pullId,
          name: s.name,
          artUrl: s.artUrl,
          tier: s.tier,
          lastCopy: s.lastCopy,
        },
        floor: houseFloor({ kind: "secret", name: s.name, artUrl: s.artUrl, tier: s.tier, concealed: false }), // prettier-ignore
      })),
    ];
  }, [spares.data]);

  const asking = Number(price);
  const priceOk =
    Number.isInteger(asking) && asking >= MARKET_PRICE_MIN && asking <= MARKET_PRICE_MAX;

  function stage(entry: { item: TradeItemView; floor: number }) {
    setStaged(entry);
    // Pre-filled with what the house would pay, so nobody shelves a platinum for
    // three by accident — the one mistake a free-text price field invites.
    setPrice(String(entry.floor));
  }

  function confirmList() {
    if (!staged || !priceOk) return;
    // The only guard between a thumb and a vanished mythic, and the same one the
    // sell counter next door uses. A roster card always leaves a copy behind; a
    // secret does not have to.
    if (staged.item.kind === "secret" && staged.item.lastCopy) {
      if (!window.confirm(`${staged.item.name} is your only copy. List it anyway?`)) return;
    }
    putUp.mutate({ item: staged.item, price: asking });
  }

  // With the economy off and nothing on the shelf there is nothing to say, and the
  // route's "not switched on yet" line says it already. Below every hook, because
  // an early return above one would change the hook order between renders.
  //
  // `!stall.isLoading` matters: this path exists so a seller can always take a
  // listing down after dust is switched off, and returning null while the stall
  // was still in flight rendered a blank frame that then popped in — which,
  // right there, reads as "my cards are gone".
  if (!dustOn && active.length === 0 && !stall.isLoading) return null;

  return (
    <div className="space-y-6">
      {dustOn && (
        <section className="rounded-lg border border-border p-4">
          <h2 className="font-display text-sm font-bold uppercase tracking-wide">The market</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Cards other people have put up. The price is theirs to set, and the dust goes straight
            to them.
          </p>

          {market.isLoading ? (
            <p className="mt-3 text-xs text-muted-foreground">Reading the shelf…</p>
          ) : listings.length === 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">Nothing for sale right now.</p>
          ) : (
            <ul className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {listings.map((listing) => {
                const meta = itemMeta(listing.item);
                const broke = balance != null && balance < listing.price;
                const busy = buying === listing.id && buy.isPending;
                return (
                  <li key={listing.id} className="flex flex-col items-center gap-1.5">
                    <TradeItemTile
                      item={asTileItem(listing)}
                      lookup={lookup}
                      size="sm"
                      concealed={listing.item.kind === "secret" && listing.item.concealed}
                      backUrl={backUrl}
                    />
                    <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                      {nameOf(listing.sellerId)}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full"
                      // Said on the button rather than discovered on tap: the RPC
                      // would refuse this anyway, and being told the price you
                      // cannot meet is more use than a toast that says no.
                      disabled={broke || busy}
                      onClick={() => {
                        setBuying(listing.id);
                        buy.mutate(listing);
                      }}
                    >
                      {busy ? "…" : broke ? `${listing.price} dust` : `Buy · ${listing.price}`}
                    </Button>
                    {meta.label && (
                      <span
                        className="text-[9px] font-bold uppercase tracking-[0.2em]"
                        style={{ color: meta.accent }}
                      >
                        {meta.label}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      <section className="rounded-lg border border-border p-4">
        <h2 className="font-display text-sm font-bold uppercase tracking-wide">Your stall</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {dustOn
            ? "Spares only, and a roster card always leaves you one. A sale is between you and the buyer — nobody else is told."
            : "The market is shut while dust is off, so nothing here can sell — but these are still yours to take back."}
        </p>

        {stall.isLoading ? (
          <p className="mt-3 text-xs text-muted-foreground">Counting your stall…</p>
        ) : active.length === 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">Nothing up at the moment.</p>
        ) : (
          <ul className="mt-3 space-y-1.5">
            {active.map((listing) => (
              <li key={listing.id} className="flex items-center justify-between gap-3">
                <StallLine listing={listing} nameFor={nameFor} nameOf={nameOf} />
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  disabled={pulling === listing.id && pull.isPending}
                  onClick={() => {
                    setPulling(listing.id);
                    pull.mutate(listing.id);
                  }}
                >
                  {pulling === listing.id && pull.isPending ? "…" : "Take down"}
                </Button>
              </li>
            ))}
          </ul>
        )}

        {dustOn && (
          <Button
            className="mt-3 w-full"
            disabled={spares.isLoading}
            onClick={() => {
              setStaged(null);
              setPrice("");
              setPicking(true);
            }}
          >
            List a card
          </Button>
        )}

        {recent.length > 0 && (
          <>
            {/* The ONLY place a sale is ever visible. A completed sale writes no
                row into the trade feed, so without this list somebody learns
                about it as "huh, I have more dust". */}
            <h3 className="mt-4 font-display text-[11px] font-bold uppercase tracking-[0.3em] text-muted-foreground">
              Lately
            </h3>
            <ul className="mt-2 space-y-1.5">
              {recent.map((listing) => (
                <li key={listing.id} className="flex items-center justify-between gap-3">
                  <StallLine listing={listing} nameFor={nameFor} nameOf={nameOf} />
                  <span className="shrink-0 text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                    {marketStatusLabel(listing.status)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {dustOn && (
        <Drawer open={picking} onOpenChange={setPicking}>
          <DrawerContent className="max-h-[85dvh]">
            <DrawerHeader>
              <DrawerTitle className="font-display text-sm font-bold uppercase tracking-wide">
                List a card
              </DrawerTitle>
              <DrawerDescription className="text-xs">
                Pick a spare, then name your price.
              </DrawerDescription>
            </DrawerHeader>

            <div className="overflow-y-auto px-4 pb-6">
              {sellable.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Nothing spare to sell yet. Roster cards need a second copy; any secret will do.
                </p>
              ) : (
                <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                  {sellable.map((entry) => {
                    const key =
                      entry.item.kind === "roster" ? entry.item.copyId : entry.item.pullId;
                    const chosen =
                    staged != null &&
                    (staged.item.kind === "roster" ? staged.item.copyId : staged.item.pullId) === key; // prettier-ignore
                    return (
                      <li key={key}>
                        <TradeItemTile
                          item={entry.item}
                          lookup={lookup}
                          size="sm"
                          selected={chosen}
                          onClick={() => stage(entry)}
                          backUrl={backUrl}
                        />
                      </li>
                    );
                  })}
                </ul>
              )}

              {staged && (
                <div className="mt-4 space-y-2 border-t border-border pt-4">
                  <label
                    htmlFor="market-price"
                    className="block font-display text-[11px] font-bold uppercase tracking-[0.3em] text-muted-foreground"
                  >
                    Your price
                  </label>
                  <Input
                    id="market-price"
                    type="number"
                    inputMode="numeric"
                    min={MARKET_PRICE_MIN}
                    max={MARKET_PRICE_MAX}
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    className="font-mono"
                  />
                  {/* A hint, never a rule. Undercutting the mill is a legitimate
                    thing to do for a card you would rather see in somebody's
                    collection than burn. */}
                  <p className="text-xs text-muted-foreground">
                    The house would pay <span className="font-mono">{staged.floor}</span>.
                  </p>
                  <Button
                    className="w-full"
                    disabled={!priceOk || putUp.isPending}
                    onClick={confirmList}
                  >
                    {putUp.isPending ? "…" : priceOk ? `List for ${asking}` : "Name a price"}
                  </Button>
                </div>
              )}
            </div>
          </DrawerContent>
        </Drawer>
      )}
    </div>
  );
}

/** One line of your own stall: what it is, what it costs, and who took it. */
function StallLine({
  listing,
  nameFor,
  nameOf,
}: {
  listing: MyMarketListing;
  nameFor: (eventParticipantId: string) => string;
  nameOf: (participantId: string) => string;
}) {
  const meta = itemMeta(listing.item);
  const title =
    listing.item.kind === "roster" ? nameFor(listing.item.eventParticipantId) : listing.item.name;
  return (
    <span className="min-w-0 truncate text-xs">
      <span className="font-bold">{title}</span>
      {meta.label && (
        <span className="ml-1.5" style={{ color: meta.accent }}>
          {meta.label}
        </span>
      )}
      <span className="ml-1.5 font-mono text-muted-foreground">{listing.price}</span>
      {listing.status === "sold" && listing.buyerId && (
        <span className="ml-1.5 text-muted-foreground">{`to ${nameOf(listing.buyerId)}`}</span>
      )}
    </span>
  );
}

/**
 * What each refusal says on a button.
 *
 * Every one of these is something a person can act on, which is why the RPCs
 * return them rather than raising — see the header of dust-db.server.ts.
 */
const BUY_REFUSALS: Record<string, string> = {
  resolved: "Somebody got there first",
  voided: "That card had already moved",
  insufficient: "Not enough dust for that one",
  own_listing: "That one's yours",
  disabled: "Dust is switched off",
};

const LIST_REFUSALS: Record<string, string> = {
  last_copy: "You would have none left",
  too_fresh: "Today's pull is not a spare yet",
  staked: "Take it off the market first",
  already_listed: "That one is already up",
  too_many: "Your stall is full — take something down first",
  bad_price: "That price is out of range",
  not_yours: "That one is not yours",
  disabled: "Dust is switched off",
};
