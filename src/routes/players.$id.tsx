import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  GitCompareArrows,
  IdCard,
  Link as LinkIcon,
  MoreHorizontal,
  PackageOpen,
  QrCode,
  RotateCw,
  Share2,
  Smartphone,
  Sparkles,
  Star,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useEventBundle } from "@/hooks/use-event-bundle";
import { useEventCardBack, useEventPhotoUrls, useEventCardUrls } from "@/hooks/use-photo-urls";
import { HoloCard } from "@/components/holo-card";
import { LockedCard, LOCKED_RARITY, LOCKED_EDITION } from "@/components/locked-card";
import {
  cardBadge,
  editionCelebrates,
  editionLabel,
  editionOddsLabel,
  editionRank,
  editionStyle,
  toEdition,
  type Edition,
} from "@/lib/card-edition";
import { ZoomPanFrame } from "@/components/zoom-pan-frame";
import { requestGyroPermission } from "@/lib/gyro";
import { ShareCard, type ShareCardData } from "@/components/share-card-graphic";
import { CardBackPanel } from "@/components/card-back-panel";
import { CardSocial } from "@/components/card-social";
import { FieldComparison } from "@/components/field-comparison";
import { RosterFilmstrip } from "@/components/roster-filmstrip";
import { CardSlab } from "@/components/card-slab";
import { useCardPullCounts } from "@/hooks/use-card-pulls";
import { rosterFavouriteId, useVaultFavourites } from "@/lib/vault-favourites";
import { packedByLabel } from "@/lib/card-pulls";
import { CardCompare } from "@/components/card-compare";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMyCollection } from "@/hooks/use-my-collection";
import { useMemberSession } from "@/lib/member-token";
import { PackStats } from "@/components/pack-stats";
import { StatTile } from "@/components/stat-tile";
import { useEventSocial, useEventAwards } from "@/hooks/use-event-social";
import { useCountUp } from "@/hooks/use-count-up";
import { awardCategory } from "@/lib/awards";
import { rarityMap, rarityStyle, TIER_REASON, type Rarity } from "@/lib/card-rarity";
import { cardStats } from "@/lib/card-stats";
import { playEditionShine, playReveal, useCardSfx } from "@/lib/card-sfx";
import { exportCardPng } from "@/lib/share-card";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Cards whose reveal has already played this page load.
 *
 * Arrowing back and forth through the roster re-mounts the same card over and
 * over, and a chime on every pass turns a flourish into a machine gun.
 */
const revealed = new Set<string>();

export const Route = createFileRoute("/players/$id")({
  head: () => ({
    meta: [
      { title: "Player Card — Will YOU Be My Hero? Draft Combine" },
      { name: "description", content: "Full player trading card for the draft combine." },
      { property: "og:title", content: "Draft Combine — Player Card" },
      { property: "og:description", content: "Tilt it, flip it, send it to the group chat." },
    ],
  }),
  // `?vs=` makes a head-to-head a link you can drop in the group chat, rather
  // than something only reachable by tapping through the drawer.
  // Annotate `vs` as optional: an inferred `{ vs: string | undefined }` makes
  // router-core treat the key as required at every Link/navigate call site.
  validateSearch: (search: Record<string, unknown>): { vs?: string } => ({
    vs: typeof search.vs === "string" && search.vs ? search.vs : undefined,
  }),
  component: PlayerCardPage,
  notFoundComponent: () => (
    <div className="p-10 text-center text-muted-foreground">
      Player not found.{" "}
      <Link to="/players" className="text-primary underline">
        Back to the vault
      </Link>
    </div>
  ),
});

function PlayerCardPage() {
  const { id } = Route.useParams();
  const { vs } = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { event, bundle, loading } = useEventBundle();
  const photos = useEventPhotoUrls(event?.id ?? null);
  const cards = useEventCardUrls(event?.id ?? null);
  // The event's back, never this player's own — see the note on useEventCardBack.
  const cardBack = useEventCardBack(event?.id ?? null);
  const social = useEventSocial(event?.id ?? null);
  const awards = useEventAwards(event?.id ?? null);
  const pullCounts = useCardPullCounts(event?.id ?? null);
  const member = useMemberSession();

  const sfx = useCardSfx();
  const favourites = useVaultFavourites();

  const [flipped, setFlipped] = useState(false);
  const [gyro, setGyro] = useState(false);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [comparing, setComparing] = useState(false);
  const shareRef = useRef<HTMLDivElement>(null);

  // Roster in running order gives prev/next a stable, meaningful sequence.
  const roster = useMemo(
    () => [...(bundle?.participants ?? [])].sort((a, b) => a.running_order - b.running_order),
    [bundle],
  );
  const index = roster.findIndex((p) => p.id === id);
  const prev = index > 0 ? roster[index - 1] : roster[roster.length - 1];
  const next = index >= 0 && index < roster.length - 1 ? roster[index + 1] : roster[0];

  const go = useCallback(
    (targetId: string | undefined) => {
      // The share export reads shareRef after an async refetch + settle delay,
      // so navigating mid-export would hand it the next card's DOM while the
      // filename still says this one. Freeze navigation until it finishes.
      if (!targetId || targetId === id || sharing) return;
      setFlipped(false);
      navigate({ to: "/players/$id", params: { id: targetId } });
    },
    [id, navigate, sharing],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (sharing) return;
      if (e.key === "ArrowLeft") go(prev?.id);
      if (e.key === "ArrowRight") go(next?.id);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, prev?.id, next?.id, sharing]);

  const rarities = useMemo(() => rarityMap(bundle), [bundle]);

  // Read-only. Opening a pack is the only thing that collects a card — this page
  // used to collect on sight, which made walking the vault a one-tap way to
  // "collect" the whole set without ever ripping a pack, and left every device
  // that did so claiming the full roster until the hook below started pruning it.
  const rosterIds = useMemo(() => roster.map((p) => p.id), [roster]);
  const mine = useMyCollection(event?.id ?? null, rosterIds);
  const collection = mine.collection;

  // Rarest card you hold. `rank` runs rarest-first, so the lowest wins.
  const bestPull = useMemo(() => {
    let best: Rarity | null = null;
    let bestFinish = editionRank(undefined);
    for (const cardId of Object.keys(collection)) {
      const r = rarities.get(cardId);
      if (!r) continue;
      // Tier first, finish only to break a tie inside it — the same ordering the
      // vault sorts by, and for the same reason.
      const finish = editionRank(collection[cardId]?.edition);
      if (!best || r.rank < best.rank || (r.rank === best.rank && finish < bestFinish)) {
        best = r;
        bestFinish = finish;
      }
    }
    return best;
  }, [collection, rarities]);

  // Resolved before the loading guard below so the reveal and the stat hooks
  // can be plain unconditional hooks. `ep` stays null until the bundle lands.
  const ep = bundle?.participants.find((p) => p.id === id) ?? null;
  const rarity = (ep && rarities.get(ep.id)) ?? rarityStyle("base");
  // Off the collection, because a finish belongs to your copy and not to the
  // player. A card you do not hold has none at all — see LOCKED_EDITION.
  const edition = ep ? toEdition(collection[ep.id]?.edition) : "standard";
  const stats = useMemo(() => cardStats(bundle, ep?.participant_id), [bundle, ep?.participant_id]);

  // The art is the thing a pack buys, so the card stays face-down until this
  // device has actually pulled it. Everything else on the page — the tier, the
  // time, the rank, the trash talk — is already public on /leaderboard and stays.
  //
  // An unready frame counts as locked: `useMyCollection` hands out an empty
  // collection until the server has reconciled, and locked→unlocked popping in is
  // a reveal, while unlocked→locked is a leak.
  const locked = !mine.ready || !ep || !collection[ep.id];

  // The chevrons and the arrow keys move between cards without unmounting this
  // page — which is why `go` has to reset `flipped` by hand — so a compare sheet
  // opened on a card you hold stayed open when the next card along was one you
  // have not packed, over a Compare chip greyed out underneath it. The surface
  // and the affordance have to agree, so the sheet goes with the chip.
  useEffect(() => {
    if (locked) setComparing(false);
  }, [locked]);

  // Landing on a card is an event: the tier chime, and a burst in the tier's own
  // colour for the two tiers worth celebrating. A cold page load has no user
  // gesture behind it, so the AudioContext stays suspended and this is silent —
  // which is the correct behaviour, not something to work around.
  useEffect(() => {
    // Never on a locked card. Landing on a face-down slot is the opposite of a
    // payoff, and a chime and confetti over it would celebrate nothing.
    if (!ep || locked || revealed.has(ep.id)) return;
    revealed.add(ep.id);
    playReveal(rarity.tier);
    playEditionShine(edition);
    // The finish can carry a card the tier never would — same gate as the pack
    // stand, so landing on a platinum base card is an event on both screens.
    if (rarity.tier !== "champion" && rarity.tier !== "podium" && !editionCelebrates(edition))
      return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let cancelled = false;
    void import("canvas-confetti").then(({ default: confetti }) => {
      if (cancelled) return;
      confetti({
        particleCount: 90,
        spread: 75,
        origin: { y: 0.4 },
        colors: [
          rarity.accent,
          rarity.holoA,
          rarity.holoB,
          ...(editionCelebrates(edition) ? [editionStyle(edition).accent] : []),
          "#ffffff",
        ],
      });
    });
    return () => {
      cancelled = true;
    };
  }, [ep, locked, edition, rarity.tier, rarity.accent, rarity.holoA, rarity.holoB]);

  // Rolled rather than snapped into place. Both return the target verbatim under
  // reduced motion, and null for a player with no official run.
  const countedTime = useCountUp(stats.bestRun?.official_time_ms ?? null);
  const countedRank = useCountUp(stats.rank);

  // Same running order as prev/next, so the strip and the chevrons agree.
  const filmstrip = useMemo(
    () =>
      roster.map((p) => {
        // A card you have not packed is a name on the strip, not its art — and
        // not its tier colour either. `RosterFilmstrip` already draws an
        // initials chip for an entry with no art, so no art is all it needs.
        const own = mine.ready && !!collection[p.id];
        return {
          id: p.id,
          name: p.participant?.name ?? "—",
          frontUrl: own ? (cards.data?.[p.id]?.front ?? null) : null,
          rarity: own ? (rarities.get(p.id) ?? LOCKED_RARITY) : LOCKED_RARITY,
          // Same withholding as the rarity beside it, and a stronger case for
          // it: a tier can be reasoned about from the leaderboard, a finish
          // cannot be known from anywhere but the pack that produced it.
          edition: own ? toEdition(collection[p.id]?.edition) : LOCKED_EDITION,
        };
      }),
    [roster, cards.data, rarities, mine.ready, collection],
  );

  const comparePool = useMemo(
    () =>
      roster.map((p) => ({
        id: p.id,
        participantId: p.participant_id,
        name: p.participant?.name ?? "—",
        rarity: rarities.get(p.id) ?? rarityStyle("base"),
      })),
    [roster, rarities],
  );

  // QR points at this card so a printed card can link to its digital twin.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    const target = `${window.location.origin}/players/${id}`;
    import("qrcode").then(({ default: QR }) =>
      QR.toDataURL(target, {
        margin: 1,
        width: 220,
        color: { dark: "#38bdf8", light: "#0b1220" },
      }).then((d) => {
        if (!cancelled) setQrUrl(d);
      }),
    );
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return <div className="p-10 text-center text-sm text-muted-foreground">Loading…</div>;
  }

  if (!ep) throw notFound();

  const urls = cards.data?.[ep.id];
  const name = ep.participant?.name ?? "—";
  const photoUrl = photos.data?.[ep.id] ?? ep.participant?.profile_image_url ?? null;
  const { bestRun, rank } = stats;

  // Reactions and comments store participant_id; the roster is the only place
  // that maps those back to names.
  const nameOf = (participantId: string) =>
    bundle?.participants.find((p) => p.participant_id === participantId)?.participant?.name ??
    "Someone";

  const cardReactions = (social.data?.reactions ?? []).filter(
    (r) => r.event_participant_id === ep.id,
  );
  const cardComments = (social.data?.comments ?? []).filter(
    (c) => c.event_participant_id === ep.id,
  );
  const myAwards = ep.participant_id ? (awards.byParticipant.get(ep.participant_id) ?? []) : [];

  const shareBadge = cardBadge(
    { label: rarity.label, reason: "", accent: rarity.accent },
    locked ? "standard" : edition,
  );

  const shareData: ShareCardData = {
    eventName: event?.name ?? "Draft Combine",
    eventYear: event?.year ?? null,
    name,
    fantasyTeam: ep.participant?.fantasy_team_name ?? null,
    quote: ep.participant?.trash_talk_quote ?? null,
    // Same rule as the ribbon: a special finish is the headline, the tier drops
    // to the second badge. accent rather than border, so the exported PNG carries
    // a visible colour — base and dnf set border to a near-transparent white,
    // which rasterised as an invisible rule.
    //
    // Never on a locked card: sharing a locked slot's finish would leak the one
    // thing about it that cannot be guessed.
    rarityLabel: shareBadge.headline,
    rarityColor: shareBadge.color,
    // No second badge: the metal is the whole caption now.
    editionLabel: null,
    editionColor: null,
    frameColor: shareBadge.isEdition ? editionStyle(edition).accent : null,
    cardUrl: urls?.front ?? null,
    photoUrl,
    runningOrder: ep.running_order,
    draftPick: ep.selected_draft_position ?? null,
    timeMs: bestRun?.official_time_ms ?? null,
    rank,
  };

  async function onShare() {
    setSharing(true);
    try {
      // Signed storage URLs expire after an hour; a stale one rasterises blank.
      await qc.refetchQueries({ queryKey: ["card-urls", event?.id] });
      // Let the refreshed <img> paint before html-to-image walks the DOM.
      await new Promise((r) => setTimeout(r, 350));
      const node = shareRef.current;
      if (!node) throw new Error("Share card not ready");
      await exportCardPng(node, `${name.replace(/\s+/g, "-").toLowerCase()}-card.png`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not export card");
    } finally {
      setSharing(false);
    }
  }

  async function onCopyLink() {
    const url = `${window.location.origin}/players/${id}${vs ? `?vs=${vs}` : ""}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch {
      // Clipboard access needs a secure context and, on some browsers, an
      // explicit permission. Showing the URL still lets someone copy it by hand.
      toast.message(url);
    }
  }

  async function onToggleGyro() {
    if (gyro) {
      setGyro(false);
      return;
    }
    const granted = await requestGyroPermission();
    if (!granted) {
      toast.error("Motion access denied");
      return;
    }
    setGyro(true);
  }

  const favouriteId = rosterFavouriteId(ep.id);
  const pinned = favourites.isFavourite(favouriteId);

  // Settings rather than actions: they change how the card behaves, and none of
  // them is the reason anyone opened the page. Declared once and rendered twice,
  // as chips on a wide screen and as menu items on a phone.
  const secondary: {
    key: string;
    label: string;
    icon: React.ReactNode;
    active?: boolean;
    onClick: () => void;
  }[] = [
    {
      key: "tilt",
      label: "Tilt",
      icon: <Smartphone className="h-3.5 w-3.5" />,
      active: gyro,
      onClick: () => void onToggleGyro(),
    },
    // Secondary rather than a fourth primary chip: the note above the action row
    // records that six chips already wrap to three rows on a phone. Only on a
    // card you own — there is nothing to pin about a slot you have not opened.
    ...(locked
      ? []
      : [
          {
            key: "pin",
            label: pinned ? "Pinned" : "Pin",
            icon: (
              <Star className="h-3.5 w-3.5" fill={pinned ? "currentColor" : "none"} aria-hidden />
            ),
            active: pinned,
            onClick: () => favourites.toggle(favouriteId),
          },
        ]),
    {
      key: "copy",
      label: "Copy Link",
      icon: <LinkIcon className="h-3.5 w-3.5" />,
      onClick: () => void onCopyLink(),
    },
    {
      key: "sound",
      label: sfx.muted ? "Muted" : "Sound",
      icon: sfx.muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />,
      active: !sfx.muted,
      onClick: sfx.toggle,
    },
  ];

  return (
    // Every tier-coloured thing below reads `--tier` off this node rather than
    // taking a prop, so one variable retints the whole page.
    <div
      className="circuit-bg relative min-h-[calc(100dvh-8rem)]"
      style={
        { "--tier": rarity.accent, "--edn": editionStyle(edition).accent } as React.CSSProperties
      }
    >
      {/* Tier wash over circuit-bg's own hard-coded cyan bloom. Sits behind the
          content, so a champion's page glows gold and a DNF's barely glows. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[70vh]"
        style={{
          background:
            "radial-gradient(ellipse 65% 55% at 50% 20%, color-mix(in oklab, var(--tier) 24%, transparent) 0%, transparent 70%)",
        }}
      />
      <div className="relative mx-auto max-w-3xl px-4 py-6">
        <div className="mb-2 flex items-center justify-between gap-3 sm:mb-4 sm:items-start">
          <Link
            to="/players"
            className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-[0.3em] text-primary hover:underline sm:pt-1"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Vault
          </Link>
          {/* One pill. A special finish takes the headline in its own metal and
              pushes the tier to the line beneath — see cardBadge. A locked card
              never shows a finish: it is unknown, and would be the biggest
              spoiler on the page. */}
          <CardRibbon rarity={rarity} edition={locked ? "standard" : edition} />
        </div>

        {/*
          The chevrons overlay the card's margins rather than sitting in a flex
          row with it, which squeezed the card. That only works where there are
          margins to overlay: on a phone the slab fills the column and the
          buttons landed on the card's own stat panel. So they are desktop-only,
          and the filmstrip below — built for exactly this, since a hero card
          claims the whole touch gesture and can't also answer to a swipe — is
          the phone's way between cards, along with the arrow keys.
        */}
        <div className="relative">
          <div className="mx-auto w-full max-w-sm">
            <CardSlab
              eventName={event?.name ?? "Draft Combine"}
              eventYear={event?.year ?? null}
              serial={ep.running_order}
              ofTotal={roster.length}
              collected={collection[ep.id] ?? null}
              leagueLine={packedByLabel(pullCounts.data?.[ep.id])}
            >
              {/* The slab stays either way — its plate carries the serial and
                  the collection mark, and both are still true of a card you have
                  not pulled. No ZoomPanFrame around a locked one: there is
                  nothing to pinch, and nothing under the swipe worth reaching. */}
              {locked ? (
                <div className="flex flex-col items-center gap-3">
                  <LockedCard back={cardBack.data?.urls ?? null} name={name} />
                  <Link to="/players/pack" className="neon-btn !px-4 !py-2 !text-xs">
                    <PackageOpen className="h-4 w-4" />
                    Rip a pack to see this card
                  </Link>
                </div>
              ) : (
                <ZoomPanFrame
                  onSwipe={(dir) => go(dir === 1 ? next?.id : prev?.id)}
                  onTap={() => setFlipped((f) => !f)}
                  canNavigate={roster.length > 1}
                  prevLabel={`Previous: ${prev?.participant?.name ?? ""}`}
                  nextLabel={`Next: ${next?.participant?.name ?? ""}`}
                  position={index >= 0 ? `${index + 1} / ${roster.length}` : undefined}
                  hint="Pinch to zoom · swipe for the next card"
                >
                  {({ zoomed }) => (
                    <HoloCard
                      frontUrl={urls?.front ?? null}
                      backUrl={urls?.back ?? null}
                      name={name}
                      rarity={rarity}
                      edition={edition}
                      flipped={flipped}
                      onFlippedChange={setFlipped}
                      gyro={gyro}
                      tilt="hero"
                      // While magnified the frame owns the pointer; a card leaning
                      // under a pan would make the thing you are reading move.
                      interactive={!zoomed}
                      flickToFlip={false}
                      backContent={
                        <CardBackPanel ep={ep} bundle={bundle} rarity={rarity} edition={edition} />
                      }
                    />
                  )}
                </ZoomPanFrame>
              )}
            </CardSlab>
          </div>
          <NavButton
            onClick={() => go(prev?.id)}
            label={`Previous: ${prev?.participant?.name ?? ""}`}
            icon={<ChevronLeft className="h-5 w-5" />}
            disabled={roster.length < 2 || sharing}
            className="left-0"
          />
          <NavButton
            onClick={() => go(next?.id)}
            label={`Next: ${next?.participant?.name ?? ""}`}
            icon={<ChevronRight className="h-5 w-5" />}
            disabled={roster.length < 2 || sharing}
            className="right-0"
          />
        </div>

        <div className="mt-4 text-center">
          <h1 className="font-display text-3xl font-black uppercase leading-none">{name}</h1>
          {ep.participant?.fantasy_team_name && (
            <div className="mt-1 text-xs uppercase tracking-widest text-muted-foreground">
              {ep.participant.fantasy_team_name}
            </div>
          )}
          {myAwards.length > 0 && (
            <div className="mt-3 flex flex-wrap justify-center gap-1.5">
              {myAwards.map((a) => {
                const cat = a.award_type ? awardCategory(a.award_type) : undefined;
                return (
                  <Link
                    key={`${a.award_type}-${a.award_name}`}
                    to="/awards"
                    className="inline-flex items-center gap-1 rounded-full border border-warn/50 bg-warn/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-warn hover:bg-warn/20"
                  >
                    <span aria-hidden>{cat?.icon ?? "🏅"}</span>
                    {a.award_name}
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {/* The three that act on the card itself are dead while it is
              face-down — there is no face to turn, export or line up against
              another. The settings below them still apply to the card you get. */}
          <ActionButton
            onClick={() => setFlipped((f) => !f)}
            active={flipped}
            disabled={locked}
            icon={<RotateCw className="h-3.5 w-3.5" />}
          >
            {flipped ? "Front" : urls?.back ? "Flip" : "Stats"}
          </ActionButton>
          <ActionButton
            onClick={onShare}
            disabled={locked || sharing}
            icon={<Share2 className="h-3.5 w-3.5" />}
          >
            {sharing ? "Rendering…" : "Share"}
          </ActionButton>
          <ActionButton
            onClick={() => setComparing(true)}
            active={!!vs}
            icon={<GitCompareArrows className="h-3.5 w-3.5" />}
            disabled={locked || roster.length < 2}
          >
            Compare
          </ActionButton>

          {/*
            Six chips wrapped to three rows on a phone and pushed the stats and
            the filmstrip off the fold. The three that are settings rather than
            actions fold behind the overflow there; a wide screen has the room
            to show all six on one line, so it still does.

            Breakpoint classes rather than useIsMobile: the hook's first render
            is always `false`, which would flash the full row on a phone.
          */}
          <div className="hidden items-center gap-2 sm:flex">
            {secondary.map((a) => (
              <ActionButton key={a.key} onClick={a.onClick} active={a.active} icon={a.icon}>
                {a.label}
              </ActionButton>
            ))}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label="More actions"
                className="tier-chip inline-flex items-center rounded-full border px-2.5 py-1.5 sm:hidden"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center" className="min-w-[10rem]">
              {secondary.map((a) => (
                <DropdownMenuItem
                  key={a.key}
                  onSelect={a.onClick}
                  className="gap-2 text-[11px] font-bold uppercase tracking-[0.2em]"
                >
                  {a.icon}
                  {a.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {ep.participant?.trash_talk_quote && (
          <blockquote
            className="mx-auto mt-6 max-w-md border-l-2 pl-4 text-sm italic text-muted-foreground"
            style={{ borderColor: "var(--tier)" }}
          >
            “{ep.participant.trash_talk_quote}”
          </blockquote>
        )}

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Order" value={`#${ep.running_order}`} />
          <StatTile
            label="Pick"
            value={ep.selected_draft_position != null ? `#${ep.selected_draft_position}` : "—"}
          />
          <StatTile label="Time" value={countedTime != null ? formatTime(countedTime) : "—"} mono />
          <StatTile
            label="Rank"
            value={countedRank != null ? `#${Math.max(1, Math.round(countedRank))}` : "—"}
          />
        </div>

        <FieldComparison ladder={stats.ladder} rank={rank} fieldSize={stats.fieldSize} />

        <RosterFilmstrip entries={filmstrip} currentId={ep.id} onSelect={go} />

        {event?.id && (
          <CardSocial
            eventId={event.id}
            eventParticipantId={ep.id}
            reactions={cardReactions}
            comments={cardComments}
            nameOf={nameOf}
          />
        )}

        {/* Your own numbers, on your own card only. `ready` keeps the inflated
            pre-prune count from ever reaching the screen. */}
        {mine.ready && member?.participantId === ep.participant_id && (
          <PackStats
            packsOpened={mine.packsOpened}
            collectedCount={mine.collectedCount}
            rosterSize={roster.length}
            dupes={mine.dupes}
            firstPackOn={mine.firstPackOn}
            best={bestPull}
          />
        )}

        {qrUrl && (
          <div className="mt-8 flex flex-col items-center gap-2">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.3em] text-muted-foreground">
              <QrCode className="h-3.5 w-3.5" /> Scan on the printed card
            </div>
            <img
              src={qrUrl}
              alt={`QR code linking to ${name}'s card`}
              className="rounded-lg border border-primary/30"
              width={140}
              height={140}
            />
          </div>
        )}
      </div>

      <CardCompare
        open={comparing}
        onOpenChange={setComparing}
        bundle={bundle}
        left={{
          id: ep.id,
          participantId: ep.participant_id,
          name,
          rarity,
        }}
        right={comparePool.find((p) => p.id === vs) ?? null}
        roster={comparePool}
        onPick={(targetId) =>
          navigate({
            to: "/players/$id",
            params: { id },
            search: { vs: targetId ?? undefined },
            replace: true,
          })
        }
      />

      {/* Offscreen 1080x1350 composite that html-to-image rasterises. Never
          mounted for a locked card: it is an export of the very art being
          withheld, and Share is disabled anyway. */}
      {!locked && (
        <div style={{ position: "fixed", top: -10000, left: -10000, pointerEvents: "none" }}>
          <ShareCard ref={shareRef} data={shareData} />
        </div>
      )}
    </div>
  );
}

function NavButton({
  onClick,
  label,
  icon,
  disabled,
  className,
}: {
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        "hud-bezel absolute top-1/2 hidden -translate-y-1/2 rounded-full border border-white/10 p-2 text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary disabled:opacity-30 md:block",
        className,
      )}
    >
      {icon}
    </button>
  );
}

/**
 * Tier badge in the page header. The label alone never said what it meant —
 * "Station King" is only a flex if you know it's the fastest split at a station,
 * so the reason rides along underneath — everywhere but a phone, where the pill
 * shrinks to the label and the reason would be a third line of chrome above a
 * card that has none of the screen left.
 */
/**
 * The one badge in the page header.
 *
 * A standard finish reads exactly as it always did — tier word, reason under it,
 * in the tier colour. A special finish takes the headline in its own metal and
 * demotes the tier to the line beneath, and swaps the card glyph for sparkles,
 * because the finish is luck rather than something somebody did on the course.
 */
function CardRibbon({ rarity, edition }: { rarity: Rarity; edition: Edition }) {
  const badge = cardBadge(
    { label: rarity.label, reason: TIER_REASON[rarity.tier] ?? "", accent: rarity.accent },
    edition,
  );
  // The tier and the finish keep separate custom properties on purpose — two
  // axes, never merged — so the ribbon picks whichever one it is wearing.
  const c = badge.isEdition ? "var(--edn)" : "var(--tier)";
  return (
    <div
      className="flex min-w-0 items-center gap-2 rounded-full border py-1 pl-2.5 pr-3 sm:py-1.5 sm:pl-3 sm:pr-3.5"
      style={{
        borderColor: `color-mix(in oklab, ${c} 45%, transparent)`,
        background: `color-mix(in oklab, ${c} 10%, transparent)`,
        boxShadow: `0 0 24px -8px ${c}`,
      }}
    >
      {badge.isEdition ? (
        <Sparkles className="h-4 w-4 shrink-0" style={{ color: c }} />
      ) : (
        <IdCard className="h-4 w-4 shrink-0" style={{ color: c }} />
      )}
      <div className="min-w-0 leading-tight">
        <div
          className="font-display truncate text-[11px] font-black uppercase tracking-[0.25em]"
          style={{ color: c }}
        >
          {badge.headline}
        </div>
        {/* On a finish this is the pull rate and nothing else — the tier is not
            repeated under its own metal. */}
        <div className="hidden truncate text-[8px] font-bold uppercase tracking-[0.15em] text-muted-foreground sm:block">
          {badge.isEdition ? (editionOddsLabel(edition) ?? "") : badge.sub}
        </div>
      </div>
    </div>
  );
}

function ActionButton({
  onClick,
  children,
  icon,
  active,
  disabled,
}: {
  onClick: () => void;
  children: React.ReactNode;
  icon: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        // Tighter on a phone: three chips plus the overflow have to sit on one
        // line, and at the desktop tracking they spill onto a second.
        "tier-chip inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.15em] transition-colors disabled:opacity-50 sm:px-3.5 sm:tracking-[0.25em]",
        active && "is-active",
      )}
    >
      {icon}
      {children}
    </button>
  );
}
