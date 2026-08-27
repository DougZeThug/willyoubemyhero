import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles } from "lucide-react";
import { useEventBundle } from "@/hooks/use-event-bundle";
import { useMemberSession } from "@/lib/member-token";
import { useSecretActor } from "@/hooks/use-daily-secret";
import { useDustBalance } from "@/hooks/use-dust";
import { useEventCardBack, useEventCardUrls } from "@/hooks/use-photo-urls";
import { useMarketListings } from "@/hooks/use-market";
import { useTradeNudge } from "@/hooks/use-trade-nudge";
import { getClaimRoster } from "@/lib/member.functions";
import { rarityMap, rarityStyle } from "@/lib/card-rarity";
import type { RosterCardLookup } from "@/components/trade-offer-card";
import { DustShopPanel } from "@/components/dust-shop";
import { MarketPanel } from "@/components/market-panel";
import { FeedDegradedBanner, FeedError, FeedLoading } from "@/components/feed-state";
import { dustLive } from "@/lib/dust";

export const Route = createFileRoute("/players/shop")({
  head: () => ({
    meta: [
      { title: "Dust — Will YOU Be My Hero?" },
      {
        name: "description",
        content:
          "Buy and sell cards for dust, spend it on a bonus pull, burn your spares, or settle a card's finish.",
      },
      { property: "og:title", content: "Will YOU Be My Hero? — Dust" },
      { property: "og:description", content: "What dust buys." },
    ],
  }),
  component: ShopPage,
});

/**
 * The dust economy, with a screen of its own.
 *
 * The chrome and the fetching live here; every transaction lives in
 * MarketPanel or DustShopPanel, both of which take what they need as props so
 * their cache bookkeeping can be pinned by a test. useEventBundle is fine on a
 * full screen — unlike in the nav, where the realtime channel it opens would ride
 * every page.
 *
 * THE MARKET COMES FIRST, and the order is the argument: player-to-player, then
 * the house, then the price table DustShopPanel ends on. What another member will
 * pay for your spare is the more interesting question, and the mill is the floor
 * underneath it rather than the headline.
 */
function ShopPage() {
  const { event, bundle, loading, error, realtimeDegraded, refetch } = useEventBundle();
  const member = useMemberSession();
  const participantId = member?.participantId ?? null;
  const actor = useSecretActor();
  const dustOn = dustLive(event);
  // Same gate the vault's chip uses: no balance to ask for while the economy is
  // off, and none to ask for on behalf of somebody with no name yet.
  const dust = useDustBalance(dustOn ? participantId : null);

  const cards = useEventCardUrls(event?.id ?? null);
  // The event's universal back, never a player's — it is what a card you have not
  // pulled yet is shown as, so it must give nothing about that card away.
  const cardBack = useEventCardBack(event?.id ?? null);

  // Joining the topic the shelf hands back is how a SELLER hears that their card
  // sold: the sale is quiet, so there is no trade feed to ride and nothing else on
  // this screen would ever go and look. Payload-free, so it only ever means "go
  // and ask properly" — see nudge.server.ts.
  const market = useMarketListings(dustOn ? participantId : null);
  useTradeNudge(market.data?.nudgeTopic ?? null, participantId);

  // The lists hold card copy ids; the bundle is the only place a name lives.
  const nameFor = useCallback(
    (eventParticipantId: string) =>
      bundle?.participants.find((p) => p.id === eventParticipantId)?.participant?.name ?? "—",
    [bundle],
  );

  // Sellers and buyers are participants rather than roster entries, and somebody
  // who has claimed a player may not be on this event's roster at all — the same
  // two-source lookup the Trading Post builds.
  const rosterFn = useServerFn(getClaimRoster);
  const roster = useQuery({
    queryKey: ["claim-roster"],
    queryFn: () => rosterFn(),
    staleTime: 5 * 60_000,
    // Not gated on the switch: the stall still renders while dust is off, and a
    // sold listing there names the person who bought it.
    enabled: !!participantId,
  });

  const nameOf = useCallback(
    (id: string) => {
      const onRoster = bundle?.participants.find((p) => p.participant_id === id);
      if (onRoster?.participant?.name) return onRoster.participant.name;
      return roster.data?.find((p) => p.id === id)?.name ?? "Someone";
    },
    [bundle, roster.data],
  );

  const rarities = useMemo(() => rarityMap(bundle ?? null), [bundle]);

  /** event_participant_id → the face the tiles render. */
  const lookup: RosterCardLookup = useMemo(() => {
    const byEp = new Map((bundle?.participants ?? []).map((p) => [p.id, p]));
    return (eventParticipantId: string) => {
      const ep = byEp.get(eventParticipantId);
      return {
        name: ep?.participant?.name ?? "—",
        frontUrl: cards.data?.[eventParticipantId]?.front ?? null,
        rarity: rarities.get(eventParticipantId) ?? rarityStyle("base"),
      };
    };
  }, [bundle, cards.data, rarities]);

  if (loading && !bundle) {
    return (
      <div className="circuit-bg min-h-[calc(100dvh-8rem)]">
        <div className="mx-auto max-w-6xl px-4 py-6">
          <FeedLoading label="Reading the combine…" />
        </div>
      </div>
    );
  }

  if (error && !bundle) {
    return (
      <div className="circuit-bg min-h-[calc(100dvh-8rem)]">
        <div className="mx-auto max-w-6xl px-4 py-6">
          <FeedError message={error.message} onRetry={() => void refetch()} />
        </div>
      </div>
    );
  }

  return (
    <div className="circuit-bg min-h-[calc(100dvh-8rem)]">
      <div className="mx-auto max-w-6xl px-4 py-6">
        {/* The same banner five other screens show. This one watches the event
          channel too and said nothing when it went down — a frozen screen
          with no signal is the exact failure the health states exist for. */}
        {(realtimeDegraded || !!error) && <FeedDegradedBanner className="mb-4" />}
        <div className="mb-5 border-b border-primary/20 pb-4">
          <div className="flex items-center gap-2 text-primary">
            <Sparkles className="h-5 w-5" />
            <span className="font-display text-xs font-bold uppercase tracking-[0.3em]">
              Economy
            </span>
          </div>
          <h1 className="mt-1 font-display text-3xl font-black uppercase leading-none">Dust</h1>
          <p className="mt-2 text-xs text-muted-foreground">
            {!dustOn
              ? "The commissioner has not switched dust on yet."
              : dust.data?.balance == null
                ? "Counting…"
                : `You have ${dust.data.balance.toLocaleString()}.`}
          </p>
        </div>

        {/* The tab disappears when dust is off, but a bookmark does not — and a
            404 on a screen that worked yesterday reads as a broken app rather
            than a switch somebody flipped.

            THE STALL SURVIVES THE SWITCH, and that is not decoration: the
            commissioner can turn the economy off with cards still on the shelf,
            and cancel_market_listing is deliberately the one RPC in the feature
            with no dust_enabled() gate so those cards are never stranded. This
            branch is what makes that reachable. MarketPanel renders the stall
            alone here — no shelf, no listing flow — and nothing at all when there
            is nothing on it, which is every case but this one. */}
        {!dustOn ? (
          <>
            <p className="text-sm text-muted-foreground">
              Nothing to spend and nothing to earn until it is.{" "}
              <Link to="/players" className="font-bold text-primary hover:underline">
                Back to the vault
              </Link>
            </p>
            {participantId && (
              <div className="mt-6">
                <MarketPanel
                  balance={dust.data?.balance}
                  participantId={participantId}
                  actor={actor}
                  eventId={event?.id ?? null}
                  nameFor={nameFor}
                  nameOf={nameOf}
                  lookup={lookup}
                  backUrl={cardBack.data?.urls ?? null}
                  dustOn={false}
                />
              </div>
            )}
          </>
        ) : !participantId ? (
          <p className="text-sm text-muted-foreground">
            Dust is banked against your name rather than this phone, so it needs a claimed player.{" "}
            <Link to="/claim" className="font-bold text-primary hover:underline">
              Claim yours
            </Link>
          </p>
        ) : (
          <div className="space-y-6">
            <MarketPanel
              balance={dust.data?.balance}
              participantId={participantId}
              actor={actor}
              eventId={event?.id ?? null}
              nameFor={nameFor}
              nameOf={nameOf}
              lookup={lookup}
              backUrl={cardBack.data?.urls ?? null}
              dustOn
            />
            <DustShopPanel
              balance={dust.data?.balance}
              participantId={participantId}
              actor={actor}
              eventId={event?.id ?? null}
              nameFor={nameFor}
            />
          </div>
        )}
      </div>
    </div>
  );
}
