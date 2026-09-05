import {
  createFileRoute,
  Link,
  notFound,
  useCanGoBack,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  GitCompareArrows,
  Link as LinkIcon,
  Maximize2,
  Medal,
  MoreHorizontal,
  PackageOpen,
  QrCode,
  RotateCw,
  Share2,
  Smartphone,
  Star,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useEventBundle } from "@/hooks/use-event-bundle";
import { useEventCardBack, useEventPhotoUrls, useEventCardUrls } from "@/hooks/use-photo-urls";
import { HoloCard } from "@/components/holo-card";
import { LockedCard, LOCKED_RARITY, LOCKED_EDITION } from "@/components/locked-card";
import { cardBadge, editionRank, editionStyle, toEdition, type Edition } from "@/lib/card-edition";
import { ZoomPanFrame } from "@/components/zoom-pan-frame";
import { requestGyroAccess } from "@/lib/gyro";
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
import { CardRibbon } from "@/components/card-ribbon";
import { CardViewer, type ViewerCard } from "@/components/card-viewer";
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
import { useCollectionTrophies } from "@/hooks/use-collection-trophies";
import { trophiesFor, trophySizeLabel, TROPHY_RARITY } from "@/lib/collection-trophies";
import { useCountUp } from "@/hooks/use-count-up";
import { awardCategory } from "@/lib/awards";
import { rarityMap, rarityStyle, type Rarity } from "@/lib/card-rarity";
import { cardStats } from "@/lib/card-stats";
import { playFlip, useCardSfx } from "@/lib/card-sfx";
import { exportCardPng, waitForPaint } from "@/lib/share-card";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { FeedDegradedBanner } from "@/components/feed-state";
import { acquisitionWindow } from "@/lib/vault-last-seen";
import { useRecentAcquisitions } from "@/hooks/use-recent-acquisitions";
import { useRevealCue } from "@/hooks/use-reveal-cue";
import { setTradeIntent } from "@/lib/trade-intent";

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
  // than something only reachable by tapping through the drawer. `?view=1` is
  // how the vault opens this route straight into the full-screen viewer (§6), so
  // the phone's back gesture closes it rather than leaving the shelf entirely.
  //
  // Annotate both as optional: an inferred `{ vs: string | undefined }` makes
  // router-core treat the key as required at every Link/navigate call site.
  //
  // `1` rather than a boolean, because a boolean serialises to `?view=true` and
  // the URL people will see and paste is the one the audit specifies.
  validateSearch: (search: Record<string, unknown>): { vs?: string; view?: 1 } => ({
    vs: typeof search.vs === "string" && search.vs ? search.vs : undefined,
    view: search.view === 1 || search.view === "1" ? 1 : undefined,
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
  const { vs: rawVs, view } = Route.useSearch();
  // The picker filters the current player out; a hand-edited URL did not,
  // which gave a comparison of somebody against themselves with every row a
  // tie. validateSearch cannot do this — it never sees the path params.
  const vs = rawVs === id ? undefined : rawVs;
  const viewing = view === 1;
  const navigate = useNavigate();
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const qc = useQueryClient();
  const { event, bundle, loading, error, realtimeDegraded } = useEventBundle();
  const photos = useEventPhotoUrls(event?.id ?? null);
  const cards = useEventCardUrls(event?.id ?? null);
  // The event's back, never this player's own — see the note on useEventCardBack.
  const cardBack = useEventCardBack(event?.id ?? null);
  const social = useEventSocial(event?.id ?? null);
  const awards = useEventAwards(event?.id ?? null);
  const trophies = useCollectionTrophies();
  const pullCounts = useCardPullCounts(event?.id ?? null);
  const member = useMemberSession();

  const sfx = useCardSfx();
  const favourites = useVaultFavourites();

  const [flipped, setFlipped] = useState(false);
  const [gyro, setGyro] = useState(false);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  // Seeded from the search parameter, which is the whole reason it exists:
  // `?vs=` is a link you drop in the group chat, and the recipient used to
  // land on the left card with the chip lit and have to tap it themselves.
  const [comparing, setComparing] = useState(!!vs);
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
      // The viewer keeps its own keyboard: `go` drops `?view=1`, so an arrow key
      // pressed over the full-screen card would step to the next player and shut
      // the viewer on the same keystroke.
      if (viewing) return;
      if (e.key === "ArrowLeft") go(prev?.id);
      if (e.key === "ArrowRight") go(next?.id);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, prev?.id, next?.id, sharing, viewing]);

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

  /**
   * When this copy arrived, if anybody knows.
   *
   * The plain day rather than "since your last visit", and that is the whole
   * reason `acquisitionWindow` exists: this page is reached BY TAPPING THE STRIP,
   * which marks the strip seen — so a window anchored on that instant would
   * already be empty by the time this read it, and the cue §6 asks for would be
   * back to firing off the per-session guard on every reload.
   *
   * Pinned at mount, so it is the same key the vault mounts and this is served out
   * of that query's cache rather than costing a second round trip. Null for a card
   * acquired outside the day — which is most of them, most of the time.
   */
  const [since] = useState(() => acquisitionWindow(Date.now()));
  const acquisitions = useRecentAcquisitions(event?.id ?? null, since);
  // Genuinely waiting for an answer, rather than holding a query that is disabled
  // and will never have one — `isPending` alone is true forever for the second.
  const acquisitionsPending = acquisitions.isPending && acquisitions.fetchStatus === "fetching";
  const acquiredAt = useMemo(() => {
    if (!ep) return null;
    // Newest first off the server, so the first match is the latest copy — which
    // is the one that makes this an event.
    return (
      acquisitions.data?.roster.find((a) => a.eventParticipantId === ep.id)?.acquiredAt ?? null
    );
  }, [acquisitions.data, ep]);

  // Landing on a card is an event — and since §7 "landing on a card" means the
  // viewer, not the stats page underneath it. The gates live in the hook.
  useRevealCue({
    active: viewing && !locked && !!ep,
    id: ep?.id ?? null,
    rarity,
    edition,
    acquiredAt,
    pending: acquisitionsPending,
  });

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

  /**
   * The roster as the viewer swipes it: running order, every card, locked ones
   * included.
   *
   * Built here rather than in the viewer because every one of these values is
   * already resolved on this page — and because a viewer that fetched for itself
   * would mount a second copy of four queries the moment it opened.
   *
   * Built only while the viewer is up. Each entry carries a CardBackPanel
   * element, and there is no reason to build thirteen of those on every render of
   * a details page that is not showing any of them.
   *
   * Not memoised beyond that: it is thirteen objects, built on a render that only
   * happens when something it reads has already changed.
   */
  const viewerCards: ViewerCard[] = !viewing
    ? []
    : roster.map((p) => {
        const shut = !mine.ready || !collection[p.id];
        const art = cards.data?.[p.id];
        const r = rarities.get(p.id) ?? rarityStyle("base");
        const e = toEdition(collection[p.id]?.edition);
        return {
          kind: "roster",
          id: p.id,
          name: p.participant?.name ?? "—",
          rarity: r,
          edition: shut ? LOCKED_EDITION : e,
          frontUrl: art?.front ?? null,
          // A locked slot wears the event's universal back, so the face-down
          // card gives nothing away about the one underneath it.
          backUrl: shut ? (cardBack.data?.urls ?? null) : (art?.back ?? null),
          back: <CardBackPanel ep={p} bundle={bundle} rarity={r} edition={e} />,
          locked: shut,
          copies: shut ? 0 : (collection[p.id]?.count ?? 0),
        };
      });

  /**
   * Out of the viewer.
   *
   * Back rather than a navigate, because the viewer is almost always reached by
   * tapping a tile: back returns to the shelf, scrolled where it was left, which
   * a fresh navigate to /players cannot do. A deep link has nothing behind it in
   * this tab, and lands in the vault instead.
   */
  const closeViewer = () => {
    if (canGoBack) router.history.back();
    else void navigate({ to: "/players" });
  };

  /** Down to the stats, in place — the viewer is the page you came for. */
  const showDetails = () =>
    void navigate({ to: ".", search: (old) => ({ ...old, view: undefined }), replace: true });

  /**
   * Back up to the card, and PUSHED rather than replaced.
   *
   * `showDetails` replaces, because dropping to the stats is staying on the same
   * card. Coming back up is not the mirror of that: replacing here would spend
   * the details entry, and then Close — which is `history.back()` — would skip
   * straight past the page you opened the viewer from and land in the vault.
   * Pushed, Close returns to exactly what was underneath.
   */
  const openViewer = () =>
    void navigate({ to: ".", search: (old) => ({ ...old, view: 1 as const }) });

  /**
   * A swipe inside the viewer.
   *
   * `replace`, because a swipe through a stack of cards is browsing one surface
   * rather than visiting thirteen pages: pushing an entry each time would make
   * Back mean "the card before this one" and strand the vault thirteen taps away
   * from a thumb that has walked the roster.
   */
  const stepViewer = (next: number) => {
    const target = viewerCards[next];
    if (!target || target.id === id) return;
    setFlipped(false);
    void navigate({
      to: "/players/$id",
      params: { id: target.id },
      search: { view: 1 as const },
      replace: true,
    });
  };

  /** Off to the Trading Post with this card already in mind — §6. */
  const goTrade = (side: "give" | "want") => {
    setTradeIntent({ side, kind: "roster", eventParticipantId: ep.id });
    void navigate({ to: "/players/trade" });
  };
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
  // Somebody else's finished sets, on somebody else's page. The public half of
  // the trophy table earning its posture: a secret set's SIZE is readable here,
  // by anyone, and only ever for a set that is already done.
  const myTrophies = trophiesFor(trophies.data?.trophies ?? [], ep.participant_id);

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
      const node = shareRef.current;
      if (!node) throw new Error("Share card not ready");
      // Waited on rather than guessed at: a fixed delay is either too long
      // on wifi or too short on a phone in a garden, and too short means a
      // shared card showing initials where a face should be.
      await waitForPaint(node);
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
    const access = await requestGyroAccess();
    if (access !== "granted") {
      // Told apart, because they are different problems with different
      // answers. The chip used to light on a desktop browser and nothing
      // moved, with no message at all.
      toast.error(
        access === "denied"
          ? "Motion access denied"
          : "This device has no motion sensor — try it on a phone.",
      );
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
    <>
      {/* Every tier-coloured thing below reads `--tier` off this node rather than
          taking a prop, so one variable retints the whole page. */}
      <div
        className="card-bg relative min-h-[calc(100dvh-8rem)]"
        style={
          { "--tier": rarity.accent, "--edn": editionStyle(edition).accent } as React.CSSProperties
        }
        // The details page is covered by the viewer, not gone: without this its
        // controls stay in the tab order and in the accessibility tree behind it,
        // which among other things puts a second "More actions" on the screen.
        // `inert` rather than unmounting — a page that unmounts and remounts on
        // every Details tap loses its scroll position and refires its queries.
        // Same tool site-nav.tsx reaches for while a ceremony has the screen.
        inert={viewing}
      >
        {/* The same banner five other screens show. This one watches the event
          channel too and said nothing when it went down — a frozen screen
          with no signal is the exact failure the health states exist for. */}
        {(realtimeDegraded || !!error) && <FeedDegradedBanner className="mb-4" />}
        {/* The one coloured light on this page, and it is the player's own tier
          rather than the house cyan — a champion's page glows gold and a DNF's
          barely glows. It used to sit over circuit-bg, whose own hard-coded
          cyan bloom it had to wash out; card-bg has no bloom of its own, so
          this now lands on a flat ground and only has to be seen. */}
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
              className="-ml-2 inline-flex min-h-11 items-center gap-1 px-2 text-label font-bold uppercase tracking-[0.08em] text-primary hover:underline"
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
                    <Link to="/players/pack" className="neon-btn-sm">
                      <PackageOpen className="h-4 w-4" />
                      Rip a pack to see this card
                    </Link>
                  </div>
                ) : (
                  <ZoomPanFrame
                    onSwipe={(dir) => go(dir === 1 ? next?.id : prev?.id)}
                    onTap={() => {
                      // The zoom frame swallows the click, so HoloCard's own
                      // toggle — and the sound that rides on it — never fires
                      // on either full-size surface.
                      playFlip();
                      setFlipped((f) => !f);
                    }}
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
                          <CardBackPanel
                            ep={ep}
                            bundle={bundle}
                            rarity={rarity}
                            edition={edition}
                          />
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

          {/* The way back up. §6 makes the viewer the default for a tap, but a
            /players/$id link dropped in the group chat lands here, and the card
            is still the thing somebody opened it for. */}
          <div className="mt-4 flex justify-center">
            <button type="button" onClick={openViewer} className="neon-btn-sm">
              <Maximize2 className="h-4 w-4" />
              View full screen
            </button>
          </div>

          <div className="mt-4 text-center">
            <h1 className="font-display text-3xl font-black uppercase leading-none">{name}</h1>
            {ep.participant?.fantasy_team_name && (
              <div className="mt-1 text-meta text-muted-foreground">
                {ep.participant.fantasy_team_name}
              </div>
            )}
            {myTrophies.length > 0 && (
              <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                {myTrophies.map((t) => (
                  <span
                    key={t.collection}
                    className="inline-flex min-h-11 items-center gap-1 rounded-full border px-3 text-label font-bold uppercase tracking-[0.08em]"
                    style={{
                      borderColor: TROPHY_RARITY.border,
                      color: TROPHY_RARITY.accent,
                      background: "oklch(0.82 0.19 85 / 10%)",
                    }}
                    // The pills below link to /awards; these link nowhere, because a
                    // set's contents are still nobody's business. The trophy says it
                    // was finished and how big it was, and that is the whole story.
                    title={`${t.label} — ${trophySizeLabel(t.size)}`}
                  >
                    <Medal aria-hidden className="h-3 w-3" />
                    {t.label} · {t.size}
                  </span>
                ))}
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
                      className="inline-flex min-h-11 items-center gap-1 rounded-full border border-warn/50 bg-warn/10 px-3 text-label font-bold uppercase tracking-[0.08em] text-warn hover:bg-warn/20"
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
              onClick={() => {
                playFlip();
                setFlipped((f) => !f);
              }}
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
              onClick={() => setComparing(!comparing)}
              active={comparing}
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
                <ActionButton
                  key={a.key}
                  onClick={a.onClick}
                  active={a.active}
                  toggle={a.key !== "copy"}
                  icon={a.icon}
                >
                  {a.label}
                </ActionButton>
              ))}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  aria-label="More actions"
                  className="tier-chip inline-flex h-11 w-11 items-center justify-center rounded-full border sm:hidden"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center" className="min-w-[10rem]">
                {secondary.map((a) => (
                  // On a phone these live inside menu items, which carry no
                  // pressed state at all — so the checkbox role is what makes
                  // "Tilt is on" expressible here.
                  <DropdownMenuItem
                    key={a.key}
                    onSelect={a.onClick}
                    role={a.key === "copy" ? undefined : "menuitemcheckbox"}
                    aria-checked={a.key === "copy" ? undefined : !!a.active}
                    className="min-h-11 gap-2 text-label font-bold uppercase tracking-[0.08em]"
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
            <StatTile
              label="Time"
              value={countedTime != null ? formatTime(countedTime) : "—"}
              mono
            />
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
              <div className="flex items-center gap-1.5 text-label font-bold uppercase tracking-[0.08em] text-muted-foreground">
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
          // aria-hidden, like the pack summary's equivalent. Mounted for the
          // whole visit, it put a second copy of every name, time and split on
          // the page for anybody reading it linearly.
          <div
            aria-hidden
            style={{ position: "fixed", top: -10000, left: -10000, pointerEvents: "none" }}
          >
            <ShareCard ref={shareRef} data={shareData} />
          </div>
        )}
      </div>

      {/* Over everything, and a SIBLING of the page rather than a child of it:
          the page is `inert` while this is up, and a viewer inside it would be
          inert too. §6: tapping a card shows the card before anything else, and
          the page behind is the second step. */}
      {viewing && (
        <CardViewer
          cards={viewerCards}
          index={index}
          onStep={stepViewer}
          onClose={closeViewer}
          onDetails={showDetails}
          onShare={onShare}
          sharing={sharing}
          // Comparing is a details activity: a vaul drawer over a dialog is two
          // dismissal gestures deep, and the sheet needs the page's own roster
          // picker under it either way.
          onCompare={
            roster.length < 2
              ? undefined
              : () => {
                  showDetails();
                  setComparing(true);
                }
          }
          onOffer={() => goTrade("give")}
          // Only where somebody could actually answer. A card nobody has packed
          // is not a card with no spares — it is one nobody can hand over, and
          // "Ask for this card" over it would be a dead end dressed as an offer.
          onAsk={(pullCounts.data?.[ep.id] ?? 0) > 0 ? () => goTrade("want") : undefined}
        />
      )}
    </>
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
        "surface-panel absolute top-1/2 hidden -translate-y-1/2 rounded-full border border-white/10 p-2 text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary disabled:opacity-30 md:block",
        className,
      )}
    >
      {icon}
    </button>
  );
}

function ActionButton({
  onClick,
  children,
  icon,
  active,
  disabled,
  toggle,
}: {
  onClick: () => void;
  children: React.ReactNode;
  icon: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  /** A setting rather than an action: `active` is a state, not a highlight. */
  toggle?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      // Pin, Sound and Tilt are all toggles and none of them said so — the
      // state was carried by a colour class alone, exactly like the nav tab.
      aria-pressed={toggle ? !!active : undefined}
      className={cn(
        // Tighter on a phone: three chips plus the overflow have to sit on one
        // line, and at the desktop tracking they spill onto a second.
        "tier-chip inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-label font-bold uppercase tracking-[0.08em] transition-colors disabled:opacity-50 sm:px-3.5",
        active && "is-active",
      )}
    >
      {icon}
      {children}
    </button>
  );
}
