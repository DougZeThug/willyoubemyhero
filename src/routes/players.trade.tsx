import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft, ArrowLeftRight, Inbox, Send } from "lucide-react";
import { useEventBundle } from "@/hooks/use-event-bundle";
import { useEventCardUrls } from "@/hooks/use-photo-urls";
import { useMemberSession } from "@/lib/member-token";
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
import { tradeSummaryLabel, type TradeItemView, type TradeSpares } from "@/lib/trades";
import { rarityMap, rarityStyle } from "@/lib/card-rarity";
import { burst } from "@/lib/card-confetti";
import {
  TradeItemTile,
  TradeOfferCard,
  type RosterCardLookup,
} from "@/components/trade-offer-card";
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
  const qc = useQueryClient();
  const cards = useEventCardUrls(event?.id ?? null);

  const myId = me?.participantId ?? null;
  const offers = useTradeOffers(myId);
  const feed = useTradeFeed(event?.id ?? null, myId);

  const [theirId, setTheirId] = useState<string | null>(null);
  const [give, setGive] = useState<Staged[]>([]);
  const [want, setWant] = useState<Staged[]>([]);
  const [pending, setPending] = useState<string | null>(null);

  const mySpares = useTradeSpares(myId);
  const theirSpares = useTradeSpares(theirId);

  const acceptFn = useServerFn(acceptTradeOffer);
  const declineFn = useServerFn(declineTradeOffer);
  const cancelFn = useServerFn(cancelTradeOffer);
  const proposeFn = useServerFn(createTradeOffer);

  // The same list /claim reads. `claimed` is the only thing that matters here:
  // create_trade_offer refuses an offer to somebody with no device to answer on.
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

  /** Everyone who has claimed their player and is not you — the only valid counterparties. */
  const counterparties = useMemo(
    () => (roster.data ?? []).filter((p) => p.claimed && p.id !== myId),
    [roster.data, myId],
  );

  async function refreshMine() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: tradeOffersKey(myId) }),
      qc.invalidateQueries({ queryKey: tradeSparesKey(myId) }),
      qc.invalidateQueries({ queryKey: tradeSparesKey(theirId) }),
      qc.invalidateQueries({ queryKey: tradeFeedKey(event?.id) }),
    ]);
  }

  async function accept(offerId: string) {
    setPending(offerId);
    try {
      const res = await acceptFn({ data: { offerId } });
      if (res.ok) {
        toast.success("Trade done");
        // The same flourish a pack pull gets, at half strength: a swap is a
        // smaller moment than a hit, but it is still a card arriving.
        void burst(rarityStyle("podium"), 0.7);
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

  // Null on the first render whether or not a token exists — useMemberSession
  // hydrates in an effect so server and client agree — so this must not be read
  // as "signed out" until the query below has something to say.
  if (!me) {
    return (
      <div className="circuit-bg min-h-[calc(100dvh-8rem)]">
        <div className="mx-auto max-w-3xl px-4 py-6">
          <Header />
          <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
            <Link to="/claim" className="font-bold text-primary underline">
              Claim your player
            </Link>{" "}
            <span className="text-muted-foreground">to trade cards.</span>
          </div>
        </div>
      </div>
    );
  }

  const inbox = offers.data?.inbox ?? [];
  const outbox = offers.data?.outbox ?? [];
  const recent = offers.data?.recent ?? [];

  return (
    <div className="circuit-bg min-h-[calc(100dvh-8rem)]">
      <div className="mx-auto max-w-3xl px-4 py-6">
        <Header />

        <section className="mb-6">
          <SectionTitle
            icon={<Inbox className="h-3.5 w-3.5" />}
            label={`Waiting on you (${inbox.length})`}
          />
          {inbox.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nobody wants your cards. Yet.</p>
          ) : (
            <div className="space-y-3">
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
                        className="neon-btn !px-4 !py-2 !text-xs disabled:opacity-50"
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => resolve(offer.id, "decline")}
                        disabled={pending === offer.id}
                        className="rounded-full border border-white/10 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground transition-colors hover:border-danger/50 hover:text-danger disabled:opacity-50"
                      >
                        Decline
                      </button>
                    </>
                  }
                />
              ))}
            </div>
          )}
        </section>

        {outbox.length > 0 && (
          <section className="mb-6">
            <SectionTitle
              icon={<Send className="h-3.5 w-3.5" />}
              label={`Out there (${outbox.length})`}
            />
            <div className="space-y-3">
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
                      className="rounded-full border border-white/10 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary disabled:opacity-50"
                    >
                      Take it back
                    </button>
                  }
                />
              ))}
            </div>
          </section>
        )}

        {/* ---------- Compose ---------- */}
        <section className="mb-6">
          <SectionTitle icon={<ArrowLeftRight className="h-3.5 w-3.5" />} label="Make an offer" />
          <div className="hud-bezel rounded-lg border border-white/10 p-3">
            <div className="mb-3 flex flex-wrap gap-1.5">
              {counterparties.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Nobody else has claimed their player yet.
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

        {/* The league-wide record. Names both sides and counts the cards, and
            says nothing about which secrets moved — the feed is built from the
            redacted summary and there is nothing else in it to show. */}
        {(feed.data ?? []).length > 0 && (
          <section>
            <SectionTitle label="Around the league" />
            <ul className="space-y-1.5">
              {(feed.data ?? []).map((t) => (
                <li key={t.id} className="text-[11px] text-muted-foreground">
                  <span className="font-bold uppercase tracking-wide text-foreground">
                    {nameOf(t.proposerId)}
                  </span>{" "}
                  sent {tradeSummaryLabel(t.proposerGave)} to{" "}
                  <span className="font-bold uppercase tracking-wide text-foreground">
                    {nameOf(t.recipientId)}
                  </span>{" "}
                  for {tradeSummaryLabel(t.recipientGave)}
                </li>
              ))}
            </ul>
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
      <h1 className="mt-2 font-display text-3xl font-black uppercase leading-none">Trading Post</h1>
      <p className="mt-2 text-xs text-muted-foreground">
        Spares only — you always keep one of everything. Editions do not travel.
      </p>
    </div>
  );
}

function SectionTitle({ icon, label }: { icon?: React.ReactNode; label: string }) {
  return (
    <div className="mb-2 flex items-center gap-1.5 text-primary">
      {icon}
      <h2 className="font-display text-[10px] font-bold uppercase tracking-[0.3em]">{label}</h2>
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
  const items: Staged[] = [
    ...(spares?.roster ?? []).map((r) => ({
      key: `r:${r.eventParticipantId}`,
      item: { kind: "roster", eventParticipantId: r.eventParticipantId } as TradeItemView,
      payload: { kind: "roster", eventParticipantId: r.eventParticipantId },
    })),
    ...(spares?.secrets ?? []).map((s) => ({
      key: `s:${s.pullId}`,
      item: {
        kind: "secret",
        pullId: s.pullId,
        name: s.name,
        artUrl: s.artUrl,
        tier: s.tier,
      } as TradeItemView,
      payload: { kind: "secret", secretPullId: s.pullId },
    })),
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
    </div>
  );
}
