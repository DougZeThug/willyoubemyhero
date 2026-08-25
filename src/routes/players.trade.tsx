import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft, ArrowLeftRight, Inbox, Send } from "lucide-react";
import { useEventBundle } from "@/hooks/use-event-bundle";
import { CollectionComplete } from "@/components/collection-complete";
import { collectionTrophiesKey } from "@/hooks/use-collection-trophies";
import { markTrophiesCelebrated, trophyKey } from "@/lib/trophy-seen";
import type { CompletedCollection } from "@/lib/collection-trophies";
import { useEventCardUrls } from "@/hooks/use-photo-urls";
import { useMemberSession } from "@/lib/member-token";
import { useAuthUser } from "@/hooks/use-account";
import { getClaimRoster } from "@/lib/member.functions";
import {
  acceptTradeOffer,
  cancelTradeOffer,
  createTradeOffer,
  declineTradeOffer,
} from "@/lib/trades.functions";
import {
  tradeFeedKey,
  tradeOffersKey,
  tradeSparesKey,
  useTradeFeed,
  useTradeOffers,
  useTradeSpares,
} from "@/hooks/use-trades";
import { markTradeOffersSeen } from "@/hooks/use-trade-badge";
import { mySecretsKey } from "@/hooks/use-daily-secret";
import { myCardStatsKey } from "@/hooks/use-my-collection";
import { cardPullCountsKey } from "@/hooks/use-card-pulls";
import {
  BLOCKED_LABEL,
  tradeSummaryLabel,
  type TradeItemView,
  type TradeSpares,
} from "@/lib/trades";
import { rarityMap, rarityRank, rarityStyle } from "@/lib/card-rarity";
import { editionRank } from "@/lib/card-edition";
import { secretTierRank } from "@/lib/secret-rarity";
import { burst } from "@/lib/card-confetti";
import {
  TradeItemTile,
  TradeOfferCard,
  type RosterCardLookup,
} from "@/components/trade-offer-card";
import { CollectorSignup } from "@/components/collector-signup";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/players/trade")({
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

/** Matches the RPC and the zod schema. Enforced here so the button can go quiet first. */
const MAX_PER_SIDE = 4;

/** A staged item, keyed so a tap can toggle it back off. */
type Staged = { key: string; item: TradeItemView; payload: Record<string, unknown> };

function TradePage() {
  const { event, bundle } = useEventBundle();
  const me = useMemberSession();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuthUser();
  const qc = useQueryClient();
  const cards = useEventCardUrls(event?.id ?? null);

  const myId = me?.participantId ?? null;
  const offers = useTradeOffers(myId);
  const feed = useTradeFeed(event?.id ?? null, myId);

  // Reading the inbox is what clears the dot, so this fires as soon as the list
  // renders rather than on a tap nobody would think to make. Above the signed-out
  // gate below, because hooks cannot live behind an early return.
  useEffect(() => {
    if (!offers.data) return;
    markTradeOffersSeen(offers.data.inbox.map((o) => o.id));
  }, [offers.data]);

  const [theirId, setTheirId] = useState<string | null>(null);
  const [give, setGive] = useState<Staged[]>([]);
  const [want, setWant] = useState<Staged[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  /**
   * Sets this trade just finished for the person holding the phone.
   *
   * A queue rather than one value: a two-way swap can close two, and the second
   * ceremony runs when the first is dismissed. Almost always empty, occasionally
   * one, and the two-entry case is why this is not a single slot.
   */
  const [completions, setCompletions] = useState<CompletedCollection[]>([]);

  const mySpares = useTradeSpares(myId);
  const theirSpares = useTradeSpares(theirId);

  const acceptFn = useServerFn(acceptTradeOffer);
  const declineFn = useServerFn(declineTradeOffer);
  const cancelFn = useServerFn(cancelTradeOffer);
  const proposeFn = useServerFn(createTradeOffer);

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

  async function refreshMine() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: tradeOffersKey(myId) }),
      qc.invalidateQueries({ queryKey: tradeSparesKey(myId) }),
      qc.invalidateQueries({ queryKey: tradeSparesKey(theirId) }),
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
          setCompletions(mine);
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
      await refreshMine();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not accept");
    } finally {
      setPending(null);
    }
  }

  async function resolve(offerId: string, kind: "decline" | "cancel") {
    setPending(offerId);
    try {
      const res = await (kind === "decline" ? declineFn : cancelFn)({ data: { offerId } });
      if (res.ok) toast.success(kind === "decline" ? "Declined" : "Offer pulled");
      else toast("That offer was already settled");
      await refreshMine();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not do that");
    } finally {
      setPending(null);
    }
  }

  async function propose() {
    if (!theirId || give.length === 0 || want.length === 0) return;
    setPending("compose");
    try {
      await proposeFn({
        data: {
          recipientId: theirId,
          give: give.map((s) => s.payload),
          want: want.map((s) => s.payload),
        },
      });
      toast.success(`Offer sent to ${nameOf(theirId)}`);
      setGive([]);
      setWant([]);
      await refreshMine();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send that offer");
    } finally {
      setPending(null);
    }
  }

  function toggle(side: "give" | "want", staged: Staged) {
    const [list, set] = side === "give" ? [give, setGive] : [want, setWant];
    if (list.some((s) => s.key === staged.key)) {
      set(list.filter((s) => s.key !== staged.key));
      return;
    }
    if (list.length >= MAX_PER_SIDE) {
      toast(`${MAX_PER_SIDE} cards a side is the limit`);
      return;
    }
    set([...list, staged]);
  }

  // A visitor with neither a player token nor an account has nothing to trade
  // with, so send them to make one rather than parking them on a dead end.
  // Waits for both identities to settle: `me` hydrates in an effect, and
  // `authLoading` covers the session lookup.
  const anonymous = !me && !authLoading && !user;
  useEffect(() => {
    if (!anonymous) return;
    void navigate({
      to: "/auth",
      search: { mode: "signup", next: "/players/trade" },
      replace: true,
    });
  }, [anonymous, navigate]);

  // Null on the first render whether or not a token exists — useMemberSession
  // hydrates in an effect so server and client agree — so this must not be read
  // as "signed out" until the query below has something to say.
  if (!me) {
    return (
      <div className="circuit-bg min-h-[calc(100dvh-8rem)]">
        <div className="mx-auto max-w-3xl px-4 py-6">
          <Header />
          {/* Signed in but nobody yet: they are not on the roster, so a paper
              code will never arrive. Name themselves and they can trade. */}
          {user && <CollectorSignup />}
          {!anonymous && !user && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
              <Link to="/claim" className="font-bold text-primary underline">
                Claim your player
              </Link>{" "}
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
    <div className="circuit-bg min-h-[calc(100dvh-8rem)]">
      {/* Outside the page column and above everything, the same way the pack
          screen mounts it. Shifting the queue on dismiss is what plays the second
          one when a single trade closed two sets. */}
      {completions[0] && (
        <CollectionComplete
          key={completions[0].collection}
          label={completions[0].label}
          size={completions[0].size}
          onDone={() => setCompletions((q) => q.slice(1))}
        />
      )}
      <div className="mx-auto max-w-3xl px-4 py-6">
        <Header />

        <section className="mb-7">
          <SectionTitle
            icon={<Inbox className="h-4 w-4" />}
            label="Waiting on you"
            count={inbox.length}
          />
          {inbox.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nobody wants your cards. Yet.</p>
          ) : (
            <OfferCarousel>
              {inbox.map((offer) => (
                <TradeOfferCard
                  key={offer.id}
                  offer={offer}
                  me={me.participantId}
                  nameOf={nameOf}
                  lookup={lookup}
                  actions={
                    <>
                      <button
                        onClick={() => accept(offer.id)}
                        disabled={pending === offer.id}
                        className="neon-btn !px-6 !py-2.5 !text-xs disabled:opacity-50"
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => resolve(offer.id, "decline")}
                        disabled={pending === offer.id}
                        className="rounded-full border border-white/10 px-6 py-2.5 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground transition-colors hover:border-danger/50 hover:text-danger disabled:opacity-50"
                      >
                        Decline
                      </button>
                    </>
                  }
                />
              ))}
            </OfferCarousel>
          )}
        </section>

        {outbox.length > 0 && (
          <section className="mb-7">
            <SectionTitle
              icon={<Send className="h-4 w-4" />}
              label="Out there"
              count={outbox.length}
            />
            <OfferCarousel>
              {outbox.map((offer) => (
                <TradeOfferCard
                  key={offer.id}
                  offer={offer}
                  me={me.participantId}
                  nameOf={nameOf}
                  lookup={lookup}
                  actions={
                    <button
                      onClick={() => resolve(offer.id, "cancel")}
                      disabled={pending === offer.id}
                      className="rounded-full border border-primary/40 px-6 py-2.5 text-[10px] font-bold uppercase tracking-[0.2em] text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
                    >
                      Take it back
                    </button>
                  }
                />
              ))}
            </OfferCarousel>
          </section>
        )}

        {/* ---------- Compose ---------- */}
        <section className="mb-6">
          <SectionTitle icon={<ArrowLeftRight className="h-3.5 w-3.5" />} label="Make an offer" />
          <div className="hud-bezel rounded-lg border border-white/10 p-3">
            <div className="mb-3 flex flex-wrap gap-1.5">
              {counterparties.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Nobody else has claimed their player or signed in yet.
                </p>
              ) : (
                counterparties.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setTheirId(p.id === theirId ? null : p.id);
                      // Their spares are half of what is staged, so keeping the
                      // selection across a switch would send cards the new
                      // counterparty does not own.
                      setGive([]);
                      setWant([]);
                    }}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.2em] transition-colors",
                      p.id === theirId
                        ? "border-primary bg-primary/15 text-primary"
                        : "border-white/10 text-muted-foreground hover:border-primary/40",
                    )}
                  >
                    {p.name}
                  </button>
                ))
              )}
            </div>

            {theirId && (
              <>
                <SparePicker
                  label={`You give (${give.length}/${MAX_PER_SIDE})`}
                  spares={mySpares.data}
                  loading={mySpares.isPending}
                  lookup={lookup}
                  staged={give}
                  onToggle={(s) => toggle("give", s)}
                />
                <SparePicker
                  label={`${nameOf(theirId)} gives (${want.length}/${MAX_PER_SIDE})`}
                  spares={theirSpares.data}
                  loading={theirSpares.isPending}
                  lookup={lookup}
                  staged={want}
                  onToggle={(s) => toggle("want", s)}
                />
                <button
                  onClick={propose}
                  disabled={pending === "compose" || give.length === 0 || want.length === 0}
                  className="neon-btn mt-3 !px-4 !py-2 !text-xs disabled:opacity-40"
                >
                  <ArrowLeftRight className="h-4 w-4" />
                  Send offer
                </button>
              </>
            )}
          </div>
        </section>

        {recent.length > 0 && (
          <section className="mb-6">
            <SectionTitle label="Recently settled" />
            <div className="space-y-2">
              {recent.map((offer) => (
                <TradeOfferCard
                  key={offer.id}
                  offer={offer}
                  me={me.participantId}
                  nameOf={nameOf}
                  lookup={lookup}
                />
              ))}
            </div>
          </section>
        )}

        {/* The league-wide record. Names both sides, counts the player cards and
            names the secrets — the summary carries a secret's name since the
            trade-feed-secret-names migration, with the old count wording as the
            fallback for trades settled before it. */}

        {(feed.data ?? []).length > 0 && (
          <section>
            <SectionTitle label="Around the league" />
            <div className="hud-bezel hud-glow max-h-72 overflow-y-auto rounded-lg border border-primary/30">
              <ul className="divide-y divide-white/10">
                {(feed.data ?? []).map((t) => (
                  <li
                    key={t.id}
                    className="px-3 py-2.5 text-[11px] leading-relaxed text-foreground"
                  >
                    <span className="font-display font-black uppercase tracking-wide">
                      {nameOf(t.proposerId)}
                    </span>{" "}
                    <span className="text-muted-foreground">sent</span>{" "}
                    <SummaryText items={t.proposerGave} />{" "}
                    <span className="text-muted-foreground">to</span>{" "}
                    <span className="font-display font-black uppercase tracking-wide">
                      {nameOf(t.recipientId)}
                    </span>{" "}
                    <span className="text-muted-foreground">for</span>{" "}
                    <SummaryText items={t.recipientGave} />
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function Header() {
  return (
    <div className="mb-5 border-b border-primary/20 pb-4">
      <Link
        to="/players"
        className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.25em] text-muted-foreground hover:text-primary"
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

function SectionTitle({
  icon,
  label,
  count,
}: {
  icon?: React.ReactNode;
  label: string;
  count?: number;
}) {
  return (
    <div className="mb-2 flex items-center gap-2 text-primary">
      {icon}
      <h2 className="font-display text-[11px] font-bold uppercase tracking-[0.3em]">{label}</h2>
      {count !== undefined && (
        <span className="rounded-full bg-primary px-2 py-0.5 font-display text-[10px] font-black text-background">
          {count}
        </span>
      )}
    </div>
  );
}

/**
 * The feed's summary, with the traded card named in the accent colour.
 *
 * `tradeSummaryLabel` already decides the wording; this only splits its result
 * on the separator so each named piece can be lit up rather than reading as one
 * grey run of text.
 */
function SummaryText({ items }: { items: Parameters<typeof tradeSummaryLabel>[0] }) {
  const parts = tradeSummaryLabel(items).split(" + ");
  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          {i > 0 && <span className="text-muted-foreground"> + </span>}
          <span className="font-semibold text-primary">{part}</span>
        </span>
      ))}
    </>
  );
}

/**
 * One offer at a time, swiped.
 *
 * A vertical stack of full-size offers buries the second one below the fold on a
 * phone, which is where this screen actually gets used. Scroll-snap rather than a
 * carousel library: the browser already does the physics.
 */
function OfferCarousel({ children }: { children: React.ReactNode[] }) {
  const [active, setActive] = useState(0);
  if (children.length === 1) return <>{children[0]}</>;
  return (
    <div>
      <div
        className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onScroll={(e) => {
          const el = e.currentTarget;
          setActive(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
        }}
      >
        {children.map((child, i) => (
          <div key={i} className="w-full shrink-0 snap-center">
            {child}
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-center gap-1.5">
        {children.map((_, i) => (
          <span
            key={i}
            className={cn(
              "h-1.5 w-1.5 rounded-full transition-colors",
              i === active ? "bg-primary" : "bg-white/25",
            )}
          />
        ))}
      </div>
    </div>
  );
}

function SparePicker({
  label,
  spares,
  loading,
  lookup,
  staged,
  onToggle,
}: {
  label: string;
  spares: TradeSpares | undefined;
  loading: boolean;
  lookup: RosterCardLookup;
  staged: Staged[];
  onToggle: (staged: Staged) => void;
}) {
  const blocked = spares?.blocked ?? [];

  const items: Staged[] = [
    // Secrets lead the strip, rarest copy first: they are what anyone opening
    // this panel is actually scrolling for, and on a phone the base cards used
    // to bury them. Every secret they hold, single copies included — `lastCopy`
    // carries through so the tile can say which ones they cannot get back.
    ...[...(spares?.secrets ?? [])]
      .sort(
        (a, b) => secretTierRank(a.tier) - secretTierRank(b.tier) || a.name.localeCompare(b.name),
      ) // prettier-ignore
      .map(
        (s): Staged => ({
          key: `s:${s.pullId}`,
          item: {
            kind: "secret",
            pullId: s.pullId,
            name: s.name,
            artUrl: s.artUrl,
            tier: s.tier,
            lastCopy: s.lastCopy,
          },
          payload: { kind: "secret", secretPullId: s.pullId },
        }),
      ),
    // One tile per COPY, so "my gold Alice" and "my standard Alice" are separately
    // pickable. Earned tier first, then finish, then the card itself — so the
    // champion's card leads and the copies of one card still sit together.
    ...[...(spares?.roster ?? [])]
      .sort(
        (a, b) =>
          rarityRank(lookup(a.eventParticipantId).rarity.tier) -
            rarityRank(lookup(b.eventParticipantId).rarity.tier) ||
          a.eventParticipantId.localeCompare(b.eventParticipantId) ||
          editionRank(a.edition) - editionRank(b.edition),
      )
      // Annotated rather than cast. An `as TradeItemView` here silently dropped
      // `lastCopy` off the secret tiles above and the marker simply never
      // rendered — the compiler had the answer and the cast threw it away.
      .map(
        (r): Staged => ({
          key: `c:${r.copyId}`,
          item: {
            kind: "roster",
            copyId: r.copyId,
            eventParticipantId: r.eventParticipantId,
            edition: r.edition,
          },
          payload: { kind: "roster", cardCopyId: r.copyId },
        }),
      ),
  ];

  return (
    <div className="mt-3">
      <div className="mb-1.5 text-[9px] font-bold uppercase tracking-[0.25em] text-muted-foreground">
        {label}
      </div>
      {loading ? (
        <p className="text-[11px] text-muted-foreground">Counting spares…</p>
      ) : items.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">No spares to trade.</p>
      ) : (
        <div className="flex gap-1 overflow-x-auto pb-1">
          {items.map((s) => (
            <TradeItemTile
              key={s.key}
              item={s.item}
              lookup={lookup}
              selected={staged.some((x) => x.key === s.key)}
              onClick={() => onToggle(s)}
            />
          ))}
        </div>
      )}
      {/* Only ever your own side: the server sends `blocked` empty for anybody
          else. Shown so "where is my card?" has an answer on the screen. */}
      {blocked.length > 0 && (
        <>
          <div className="mt-2 text-[9px] font-bold uppercase tracking-[0.25em] text-muted-foreground/70">
            Can&apos;t be traded
          </div>
          <div className="flex gap-1 overflow-x-auto pb-1">
            {blocked.map((b) => (
              <TradeItemTile
                key={b.item.kind === "secret" ? `bs:${b.item.pullId}` : `bc:${b.item.copyId}`}
                item={b.item}
                lookup={lookup}
                blockedLabel={BLOCKED_LABEL[b.reason]}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
