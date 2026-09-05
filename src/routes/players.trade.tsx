import {
  createFileRoute,
  Link,
  useCanGoBack,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft, ArrowLeftRight } from "lucide-react";
import { useEventBundle } from "@/hooks/use-event-bundle";
import { CollectionComplete } from "@/components/collection-complete";
import { PresentationMode } from "@/components/presentation-mode";
import { collectionTrophiesKey } from "@/hooks/use-collection-trophies";
import { markTrophiesCelebrated, trophyKey } from "@/lib/trophy-seen";
import type { CompletedCollection } from "@/lib/collection-trophies";
import { useEventCardBack, useEventCardUrls } from "@/hooks/use-photo-urls";
import { useMemberSession } from "@/lib/member-token";
import { useAuthUser } from "@/hooks/use-account";
import { getClaimRoster } from "@/lib/member.functions";
import {
  acceptTradeOffer,
  cancelTradeOffer,
  createTradeOffer,
  declineTradeOffer,
  reopenTradeOffer,
} from "@/lib/trades.functions";
import {
  tradeFeedKey,
  tradeOffersKey,
  tradeSparesKey,
  useTradeFeed,
  useTradeOffers,
} from "@/hooks/use-trades";
import { markTradeOffersSeen } from "@/hooks/use-trade-badge";
import { mySecretsKey } from "@/hooks/use-daily-secret";
import { myCardStatsKey } from "@/hooks/use-my-collection";
import { cardPullCountsKey } from "@/hooks/use-card-pulls";
import { takeTradeIntent, type TradeIntent } from "@/lib/trade-intent";
import type { Staged } from "@/lib/trade-staging";
import { rarityMap, rarityStyle } from "@/lib/card-rarity";
import { burst } from "@/lib/card-confetti";
import type { RosterCardLookup } from "@/components/trade-offer-card";
import { TradeBuilder } from "@/components/trade-builder";
import { TradeFeedPanel } from "@/components/trade-feed";
import { TradeOffersPanel } from "@/components/trade-offers";
import { CollectorSignup } from "@/components/collector-signup";
import { cn } from "@/lib/utils";
import { FeedDegradedBanner } from "@/components/feed-state";
import { isOnlineNow, OFFLINE_MESSAGE, useIsOnline } from "@/hooks/use-online";

export const Route = createFileRoute("/players/trade")({
  /**
   * `make=1` is the builder being open, and nothing else.
   *
   * A search param rather than component state so the phone's back gesture
   * closes the builder instead of walking off the Trading Post with a half-built
   * offer. It names no card — `theirId` and both trays stay in memory — so the
   * rule that a secret card must never be addressable is untouched.
   *
   * The return type is annotated rather than inferred, for the reason
   * players.$id.tsx records: an inferred `{ make: 1 | undefined }` makes
   * router-core treat the key as REQUIRED at every call site, and three other
   * screens link here without it.
   */
  validateSearch: (search: Record<string, unknown>): { make?: 1 } => ({
    make: search.make === 1 || search.make === "1" ? 1 : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Trading Post — Will YOU Be My Hero? Draft Combine" },
      {
        name: "description",
        content: "Swap your spare cards with the rest of the league. Offer, haggle, accept.",
      },
      { property: "og:title", content: "Draft Combine — Trading Post" },
      { property: "og:description", content: "Your dupes are somebody else's missing card." },
    ],
  }),
  component: TradePage,
});

type Tab = "offers" | "feed";

/**
 * How long the offer you just sent stays ringed in the outbox.
 *
 * Long enough to outlive `refreshMine()`, because the card does not exist yet
 * when the highlight is set — it arrives with the refetch. Short enough to be
 * over before anybody acts on it, so it never reads as a state the offer is in.
 */
const HIGHLIGHT_MS = 4000;

function TradePage() {
  const { event, bundle, error, realtimeDegraded } = useEventBundle();
  const me = useMemberSession();
  const navigate = useNavigate();
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const { make } = Route.useSearch();
  const { user, loading: authLoading } = useAuthUser();
  const qc = useQueryClient();
  const cards = useEventCardUrls(event?.id ?? null);
  // The event's universal back, never a player's — it is what a card you have not
  // pulled yet is shown as, so it must give nothing about that card away.
  const cardBack = useEventCardBack(event?.id ?? null);
  const backUrl = cardBack.data?.urls ?? null;
  // Every control on this screen moves cards on a server. Offline they can only
  // fail, and a trade that fails silently reads as one that happened — so they
  // go quiet with the reason on them rather than throwing a toast a second
  // later. Reading the inbox still works: that half is cache.
  const offline = !useIsOnline();

  const myId = me?.participantId ?? null;
  const offers = useTradeOffers(myId);
  const feed = useTradeFeed(event?.id ?? null, myId);

  // Reading the inbox is what clears the dot, so this fires as soon as the list
  // renders rather than on a tap nobody would think to make. Above the signed-out
  // gate below, because hooks cannot live behind an early return — and in the
  // ROUTE rather than in the Offers panel, or the dot would stop clearing the day
  // somebody deep-links to the Feed tab.
  useEffect(() => {
    if (!offers.data) return;
    markTradeOffersSeen(offers.data.inbox.map((o) => o.id));
  }, [offers.data]);

  const [tab, setTab] = useState<Tab>("offers");
  const [pending, setPending] = useState<string | null>(null);
  /** The offer just sent, so the outbox can say which one it is. */
  const [highlightId, setHighlightId] = useState<string | null>(null);
  /**
   * Sets this trade just finished for the person holding the phone.
   *
   * A queue rather than one value: a two-way swap can close two, and the second
   * ceremony runs when the first is dismissed. Almost always empty, occasionally
   * one, and the two-entry case is why this is not a single slot.
   */
  const [completions, setCompletions] = useState<CompletedCollection[]>([]);

  /**
   * The card somebody tapped "Offer this card" or "Ask for this card" on (§6).
   *
   * Taken in a state initialiser, so it is consumed exactly once per arrival at
   * this route: a second visit is a blank builder, which is what an intent left
   * lying around would quietly stop being. Kept here rather than in the builder
   * because the builder is not mounted when the route arrives.
   */
  const [intent] = useState<TradeIntent | null>(() => takeTradeIntent());

  const acceptFn = useServerFn(acceptTradeOffer);
  const declineFn = useServerFn(declineTradeOffer);
  const cancelFn = useServerFn(cancelTradeOffer);
  const proposeFn = useServerFn(createTradeOffer);
  const reopenFn = useServerFn(reopenTradeOffer);

  // The same list /claim reads, but a different column of it: `reachable`, which
  // is "claimed a code OR signed into an account". create_trade_offer applies the
  // same test, so the picker and the server agree about who can be offered to.
  const rosterFn = useServerFn(getClaimRoster);
  const roster = useQuery({
    queryKey: ["claim-roster"],
    queryFn: () => rosterFn(),
    staleTime: 5 * 60_000,
  });

  const nameOf = useMemo(() => {
    const byId = new Map(
      (bundle?.participants ?? []).map((p) => [p.participant_id, p.participant?.name ?? "Someone"]),
    );
    for (const p of roster.data ?? []) if (!byId.has(p.id)) byId.set(p.id, p.name);
    return (participantId: string) => byId.get(participantId) ?? "Someone";
  }, [bundle, roster.data]);

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

  /** Everyone reachable on a device and not you — the only valid counterparties. */
  const counterparties = useMemo(
    () => (roster.data ?? []).filter((p) => p.reachable && p.id !== myId),
    [roster.data, myId],
  );

  const builderOpen = make === 1;

  function openBuilder() {
    void navigate({ to: ".", search: (old) => ({ ...old, make: 1 as const }) });
  }

  function closeBuilder() {
    // Back rather than a fresh navigate, so the history entry the open pushed is
    // spent rather than stacked — otherwise Back reopens what you just cancelled.
    if (canGoBack) router.history.back();
    else void navigate({ to: ".", search: {}, replace: true });
  }

  /**
   * An intent opens the builder on arrival, REPLACING the entry rather than
   * pushing one.
   *
   * Both places that set an intent push `/players/trade` themselves, so replacing
   * here means Back from the builder returns to the card somebody was looking at.
   * Pushing would strand them on an empty Offers tab instead.
   */
  useEffect(() => {
    if (!intent || builderOpen) return;
    void navigate({ to: ".", search: { make: 1 as const }, replace: true });
  }, [intent, builderOpen, navigate]);

  useEffect(() => {
    if (!highlightId) return;
    const t = setTimeout(() => setHighlightId(null), HIGHLIGHT_MS);
    return () => clearTimeout(t);
  }, [highlightId]);

  async function refreshMine() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: tradeOffersKey(myId) }),
      // The viewer prefix: theirs and mine alike.
      qc.invalidateQueries({ queryKey: tradeSparesKey(myId) }),
      qc.invalidateQueries({ queryKey: tradeFeedKey(event?.id) }),
      // The collection caches too, rather than leaving them to the realtime
      // handler in useTradeFeed. That handler is what updates everybody ELSE, and
      // it is the wrong thing to depend on for the person who just pressed
      // accept: the channel may still be subscribing when they arrive from the
      // vault and act immediately, and realtime may be unavailable entirely.
      // Their own answer is already in hand here. `my-card-stats` holds for 60s
      // and `my-secrets` for five minutes, so getting this wrong shows somebody
      // their pre-trade collection for minutes after the trade landed.
      qc.invalidateQueries({ queryKey: cardPullCountsKey(event?.id) }),
      qc.invalidateQueries({ queryKey: myCardStatsKey(event?.id, myId) }),
      qc.invalidateQueries({ queryKey: mySecretsKey(myId ? `m:${myId}` : null) }),
    ]);
  }

  async function accept(offerId: string) {
    setPending(offerId);
    try {
      const res = await acceptFn({ data: { offerId } });
      if (res.ok) {
        // MINE ONLY: a two-way swap can finish a set for the other person too and
        // the response names them both, but their ceremony is theirs — the realtime
        // subscription on collection_trophies is what tells their phone.
        //
        // Defaulted rather than asserted, because this response crosses a version
        // boundary: a phone left open across a deploy, or a stubbed response, and
        // reading `.filter` off an absent field turns a trade that worked into a
        // thrown error on the one screen that just moved somebody's cards.
        const mine = (res.completedCollections ?? []).filter((c) => c.participantId === myId);
        if (mine.length) {
          // Claimed before the refetch, so the global host does not play these a
          // second time. The OTHER party's trophies are deliberately left
          // unclaimed — their phone is where those belong.
          if (myId) {
            markTrophiesCelebrated(mine.map((c) => trophyKey(myId, c.collection)));
          }
          qc.invalidateQueries({ queryKey: collectionTrophiesKey() });
          // Queued rather than collapsed: one trade genuinely can close two sets,
          // and showing one of them would be a worse bug than showing neither.
          // Append so concurrent accepts for different offers do not overwrite
          // ceremonies that are still waiting to play.
          setCompletions((q) => [...q, ...mine]);
        } else {
          toast.success("Trade done");
          // The same flourish a pack pull gets, at half strength: a swap is a
          // smaller moment than a hit, but it is still a card arriving.
          void burst(rarityStyle("podium"), 0.7);
        }
      } else if (res.reason === "voided") {
        toast.error("One of those cards has already moved on");
      } else {
        toast("That offer was already settled");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not accept");
    } finally {
      // In `finally` because a dropped connection AFTER the server moved the
      // cards throws here, and skipping the refresh would leave the vault, the
      // spares and the secrets showing the pre-trade collection for minutes.
      await refreshMine();
      setPending(null);
    }
  }

  /**
   * Put back an offer this device has just declined or pulled.
   *
   * The one reversible answer in the app, which is why it is the only one that
   * gets an Undo (§19): neither decline nor cancel moves a card, so
   * `reopen_trade_offer` is a status flip and not a re-trade. Every condition —
   * that it is still declined or cancelled, that this is the person who answered
   * it, that it is inside the window, and that every staked card is still held —
   * is decided under lock in the RPC. This only reports.
   */
  async function undoResolve(offerId: string, kind: "decline" | "cancel") {
    // Quiet for the same reason every other write on this screen is: offline it
    // can only fail, and an Undo that appears to have worked is worse than one
    // that says it cannot.
    //
    // Asked of the browser rather than read off `offline`, because the toast is
    // mounted at the app root and outlives this route: walk back to the vault
    // with it still up and every React value this closure captured stops moving,
    // including a ref an effect here was keeping current.
    if (!isOnlineNow()) {
      toast(OFFLINE_MESSAGE);
      return;
    }
    try {
      const res = await reopenFn({ data: { offerId } });
      if (res.ok) toast.success(kind === "decline" ? "Offer's back" : "Offer's out there again");
      else if (res.reason === "stale") toast.error("One of those cards has already moved on");
      else if (res.reason === "expired") toast("Too late to undo that one");
      else toast("That offer was already settled");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not undo that");
    } finally {
      // Whatever happened, both screens are now wrong about this offer.
      await refreshMine();
    }
  }

  async function resolve(offerId: string, kind: "decline" | "cancel") {
    setPending(offerId);
    try {
      const res = await (kind === "decline" ? declineFn : cancelFn)({ data: { offerId } });
      if (res.ok) {
        // Five seconds on screen, against the longer window the RPC allows: the
        // toast is the prompt, and the slack behind it is what a slow round trip
        // and a backgrounded tab need. Offered on the success path only — an
        // offer somebody else already settled has nothing to put back.
        toast.success(kind === "decline" ? "Declined" : "Offer pulled", {
          duration: 5000,
          action: {
            label: "Undo",
            onClick: () => void undoResolve(offerId, kind),
          },
        });
      } else toast("That offer was already settled");
      await refreshMine();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not do that");
    } finally {
      setPending(null);
    }
  }

  /**
   * Send what the builder built.
   *
   * Answers with the new offer's id so the outbox can ring it, or null so the
   * builder knows to stay open with every staged card still in place — a failure
   * that closed the flow would throw away work nobody could get back.
   */
  async function propose(offer: {
    recipientId: string;
    give: Staged[];
    want: Staged[];
  }): Promise<string | null> {
    setPending("compose");
    try {
      const res = await proposeFn({
        data: {
          recipientId: offer.recipientId,
          give: offer.give.map((s) => s.payload),
          want: offer.want.map((s) => s.payload),
        },
      });
      toast.success(`Offer sent to ${nameOf(offer.recipientId)}`);
      setTab("offers");
      setHighlightId(res.offerId ?? null);
      // Replace rather than history.back(): back out of a SENT offer must not be
      // able to reopen a builder holding cards that have already moved.
      void navigate({ to: ".", search: {}, replace: true });
      await refreshMine();
      return res.offerId ?? null;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send that offer");
      return null;
    } finally {
      setPending(null);
    }
  }

  // A visitor with neither a player token nor an account has nothing to trade
  // with, so send them somewhere they can get one rather than parking them on a
  // dead end. Waits for both identities to settle: `me` hydrates in an effect,
  // and `authLoading` covers the session lookup.
  //
  // /claim, not /auth?mode=signup. Most people arriving here are league members
  // holding a paper code, for whom an account is optional — pushing them into
  // creating one sends the commonest visitor down the wrong path. The claim
  // screen carries the account route for anybody who is not on the roster.
  const anonymous = !me && !authLoading && !user;
  useEffect(() => {
    if (!anonymous) return;
    void navigate({ to: "/claim", replace: true });
  }, [anonymous, navigate]);

  // Null on the first render whether or not a token exists — useMemberSession
  // hydrates in an effect so server and client agree — so this must not be read
  // as "signed out" until the query below has something to say.
  if (!me) {
    return (
      <div className="card-bg min-h-[calc(100dvh-8rem)]">
        <div className="mx-auto max-w-3xl px-4 py-6">
          <Header />
          {/* Signed in but nobody yet: they are not on the roster, so a paper
              code will never arrive. Name themselves and they can trade. */}
          {user && <CollectorSignup />}
          {!anonymous && !user && (
            <div className="flex flex-wrap items-center gap-x-1.5 rounded-lg border border-primary/30 bg-primary/5 px-4 py-1 text-sm">
              {/* The only thing to press in this panel, so it is a control
                  rather than a word in a sentence that happens to be blue. */}
              <Link
                to="/claim"
                className="inline-flex min-h-11 items-center font-bold text-primary underline"
              >
                Claim your player
              </Link>
              <span className="text-muted-foreground">to trade cards.</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  const inbox = offers.data?.inbox ?? [];
  const outbox = offers.data?.outbox ?? [];
  const recent = offers.data?.recent ?? [];

  return (
    <div className="card-bg min-h-[calc(100dvh-8rem)]">
      {/* Outside the page column and above everything, the same way the pack
          screen mounts it. Shifting the queue on dismiss is what plays the second
          one when a single trade closed two sets. */}
      {/* A ceremony only, and deliberately NOT the builder. The flag this writes
          is read by two things: the nav, which it fades out, and ShellFeedback,
          which it unmounts — toaster included. That is right for a card arriving
          and wrong for a working screen: the builder raises the cap refusal and
          the "offer sent" confirmation, and under this flag neither of them ever
          reached a phone. The builder claims the screen the other way instead —
          it paints over the nav at z-50 and traps focus — so nothing is lost by
          leaving the flag alone. */}
      <PresentationMode active={!!completions[0]} />
      {completions[0] && (
        <CollectionComplete
          key={completions[0].collection}
          label={completions[0].label}
          size={completions[0].size}
          onDone={() => setCompletions((q) => q.slice(1))}
        />
      )}

      {builderOpen && (
        <TradeBuilder
          me={me.participantId}
          counterparties={counterparties}
          nameOf={nameOf}
          lookup={lookup}
          backUrl={backUrl}
          outOfSeason={!event}
          offline={offline}
          sending={pending === "compose"}
          intent={intent}
          onSend={propose}
          onClose={closeBuilder}
        />
      )}

      <div className="mx-auto max-w-3xl px-4 pb-32 pt-6">
        <Header />
        {/* The same banner five other screens show. This one watches the event
          channel too and said nothing when it went down — a frozen screen
          with no signal is the exact failure the health states exist for. */}
        {(realtimeDegraded || !!error) && <FeedDegradedBanner className="mb-4" />}

        {/* aria-pressed buttons rather than a tablist, and that is not a
            shortcut: `role="tab"` makes the controls invisible to
            getByRole("button"), which is how the e2e suite reaches every
            selectable thing in this app. */}
        <div role="group" aria-label="Trading Post sections" className="mb-5 flex gap-1.5">
          <TabButton on={tab === "offers"} onPress={() => setTab("offers")} count={inbox.length}>
            Offers
          </TabButton>
          <TabButton on={tab === "feed"} onPress={() => setTab("feed")}>
            Feed
          </TabButton>
        </div>

        {tab === "offers" ? (
          <TradeOffersPanel
            me={me.participantId}
            inbox={inbox}
            outbox={outbox}
            recent={recent}
            nameOf={nameOf}
            lookup={lookup}
            backUrl={backUrl}
            pending={pending}
            offline={offline}
            onAccept={accept}
            onDecline={(id) => void resolve(id, "decline")}
            onCancel={(id) => void resolve(id, "cancel")}
            highlightId={highlightId}
            onMakeOffer={openBuilder}
            reachableCount={counterparties.length}
          />
        ) : (
          <TradeFeedPanel entries={feed.data ?? []} nameOf={nameOf} loading={feed.isPending} />
        )}
      </div>

      {/* Above the tab bar and always there, so starting a trade never means
          scrolling past everything you have not answered (§10 problem 1).
          `z-20` keeps it under the nav's z-30: a CTA that paints over a tab is
          worse than one that scrolls under it. */}
      {!builderOpen && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 px-4 pb-[calc(env(safe-area-inset-bottom)+4.5rem)] md:pb-4">
          <div className="pointer-events-auto mx-auto max-w-3xl">
            <button type="button" onClick={openBuilder} className="neon-btn-lg w-full">
              <ArrowLeftRight className="h-4 w-4" />
              Make an offer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function TabButton({
  on,
  onPress,
  count,
  children,
}: {
  on: boolean;
  onPress: () => void;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onPress}
      className={cn(
        "inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg font-display text-badge font-bold uppercase tracking-[0.08em] transition-colors",
        on
          ? "bg-primary/15 text-primary ring-2 ring-primary/50"
          : "border border-white/10 text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
      {/* Only when there is something waiting: a "0" beside Offers reads as a
          score rather than as a count of things to answer. */}
      {!!count && (
        <span className="rounded-full bg-primary px-1.5 font-display text-meta font-black tabular text-background">
          {count}
        </span>
      )}
    </button>
  );
}

function Header() {
  return (
    <div className="mb-5 border-b border-primary/20 pb-4">
      <Link
        to="/players"
        className="-ml-2 inline-flex min-h-11 items-center gap-1.5 px-2 text-label font-bold uppercase tracking-[0.08em] text-muted-foreground hover:text-primary"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        The Vault
      </Link>
      {/* Two-tone rather than flat: the trade tab is the social one, and the
          heading is the only thing on it that gets to shout. */}
      <h1 className="mt-2 bg-gradient-to-r from-primary via-primary to-warn bg-clip-text font-display text-4xl font-black uppercase leading-none text-transparent">
        Trading Post
      </h1>
      <p className="mt-2 text-xs text-muted-foreground">
        Player cards: spares only, you always keep one. Secrets: anything you hold, even your last
        copy. The finish travels with the card.
      </p>
    </div>
  );
}
