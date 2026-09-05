import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Layers, Check, Medal } from "lucide-react";
import { useEventBundle } from "@/hooks/use-event-bundle";
import { useEventCardBack, useEventCardUrls } from "@/hooks/use-photo-urls";
import { HoloCard } from "@/components/holo-card";
import { LOCKED_EDITION, LockedCard } from "@/components/locked-card";
import { CardSkeleton } from "@/components/card-skeleton";
import { rarityMap, rarityStyle } from "@/lib/card-rarity";
import { cardBadge, editionRank, toEdition } from "@/lib/card-edition";
import { useMemberSession, WAS_MEMBER_KEY } from "@/lib/member-token";
import { useMySecrets, useSecretActor, useSecretStatus } from "@/hooks/use-daily-secret";
import { useCardPullCounts } from "@/hooks/use-card-pulls";
import { useTradeBadge } from "@/hooks/use-trade-badge";
import { useStreakStatus } from "@/hooks/use-streak";
import { useMyCollection } from "@/hooks/use-my-collection";
import { useDustBalance } from "@/hooks/use-dust";
import { dustLive } from "@/lib/dust";
import { packedByLabel } from "@/lib/card-pulls";
import { formatDay } from "@/lib/format";
import { SecretCardSheet } from "@/components/secret-card-sheet";
import { VaultSection } from "@/components/vault-section";
import { VaultHero } from "@/components/vault-hero";
import { TodayCard } from "@/components/today-card";
import type { NewSinceItem } from "@/components/new-since-strip";
import { VaultSortChip, VaultSortSheet } from "@/components/vault-sort-sheet";
import { MilestoneReveal } from "@/components/milestone-reveal";
import { PresentationMode, PresentationStage } from "@/components/presentation-mode";
import { FavouriteButton } from "@/components/favourite-button";
import { LevelPips } from "@/components/level-pips";
import {
  groupBySecretCollection,
  secretFoil,
  secretOwed,
  secretWaiting,
  SECRET_RARITY,
  VAULT_UNSORTED_LABEL,
  type OwnedSecret,
} from "@/lib/secret-cards";
import {
  FAVOURITES_SECTION,
  ROSTER_SECTION,
  secretSectionId,
  TROPHIES_SECTION,
  useVaultLayout,
  useVaultPrefs,
  type VaultSort,
} from "@/lib/vault-layout";
import { useCollectionTrophies } from "@/hooks/use-collection-trophies";
import {
  completedIds,
  trophiesFor,
  trophySizeLabel,
  TROPHY_RARITY,
  type CollectionTrophy,
} from "@/lib/collection-trophies";
import { rosterFavouriteId, secretFavouriteId, useVaultFavourites } from "@/lib/vault-favourites";
import { getSecretCollections } from "@/lib/secret-cards.functions";
import { secretTierCaption, secretTierStyle } from "@/lib/secret-rarity";
import { newSeed, seededRng, shuffle } from "@/lib/format";
import { CollectorSignupGate } from "@/components/collector-signup";
import { cn } from "@/lib/utils";
import { FeedDegradedBanner } from "@/components/feed-state";
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";
import { useAccountSyncState } from "@/lib/account-sync-state";
import { usePackProgress } from "@/hooks/use-pack-progress";
import { useMilestoneClaim } from "@/hooks/use-milestone-claim";
import { useIsOnline } from "@/hooks/use-online";
import { nextLocalMidnight } from "@/lib/pack";
import { vaultSummaryLine } from "@/lib/vault-summary";
import {
  acquisitionWindow,
  isNewSince,
  markVaultSeen,
  useVaultLastSeen,
} from "@/lib/vault-last-seen";
import { useRecentAcquisitions } from "@/hooks/use-recent-acquisitions";
import { urlFromSet } from "@/lib/media";

export const Route = createFileRoute("/players/")({
  head: () => ({
    meta: [
      { title: "The Vault — Will YOU Be My Hero?" },
      {
        name: "description",
        content: "Every card you hold. Tilt them, flip them, collect the set.",
      },
      { property: "og:title", content: "Will YOU Be My Hero? — The Vault" },
      { property: "og:description", content: "Every athlete, every card." },
    ],
  }),
  component: PlayersPage,
});

/**
 * Where a card you have not packed sits in the rarity sort.
 *
 * Its real rank, not a sentinel, would float the locked champion to position one
 * and name it — the sort itself becoming the leak the face-down slot exists to
 * close. One shared rank for every locked card, so they fall back to the name
 * tie-break and say nothing about each other either. Well clear of the real ones,
 * which run 0..9.
 */
const LOCKED_RARITY_RANK = 99;

/**
 * How many placeholders to draw while even the roster is still unknown.
 *
 * Six is two rows on a phone — enough to read as a shelf rather than a stray
 * tile. It cannot be the right number, because the number is the thing not yet
 * known: a league smaller than this watches a couple of placeholders disappear
 * when the bundle lands, which is a smaller lie than a shelf that reads as
 * empty. The moment the roster is in, `rows.length` takes over, and that is the
 * common case — the roster is public and cached, and it is the *collection*
 * query underneath it that keeps everyone waiting.
 */
const SKELETON_TILES = 6;

function PlayersPage() {
  const { event, bundle, error, loading: eventLoading, realtimeDegraded } = useEventBundle();
  const cards = useEventCardUrls(event?.id ?? null);
  // Hoisted once for the whole grid, and the *event's* back rather than each
  // player's — see the note on useEventCardBack. A player's own back on their
  // locked slot would be half the reveal, printed on the thing hiding it.
  const cardBack = useEventCardBack(event?.id ?? null);
  /**
   * The SEED is ephemeral on purpose while the sort itself is stored: a frozen
   * shuffle is not a shuffle, so a device that reloads on it gets a fresh deal.
   *
   * Which means it has to be minted, not counted from zero. A counter starting
   * at 0 on every mount made `evt:0` the seed of every reload, so the "fresh
   * deal" this comment promises was the same deal every time — the one order
   * the persisted sort could never escape.
   *
   * Minted lazily rather than during render, and safe against hydration for a
   * reason worth writing down: `useVaultPrefs` starts at the default and settles
   * from an effect, so `sort` is "name" on the server AND on the first client
   * render. The shuffle branch is not taken until after hydration, which is the
   * only moment a server seed and a client seed could have disagreed.
   */
  const [shuffleSeed, setShuffleSeed] = useState(newSeed);
  const [sortSheetOpen, setSortSheetOpen] = useState(false);
  // How this device reads the binder. Read here rather than beside the shelf
  // arrangement below, because the sort is what builds the grid the arrangement
  // is then computed from — see useVaultPrefs.
  const { sort, filter, density, setSort, setFilter, setDensity } = useVaultPrefs();
  const member = useMemberSession();
  // Members only: dust_ledger is keyed on a participant, so a guest has no
  // balance to show and the hook stays disabled rather than asking and being
  // refused. And only while the commissioner has the economy switched on —
  // asking for a balance nobody can spend is a round trip for a chip that is
  // not going to render.
  const dustOn = dustLive(event);
  const dust = useDustBalance(dustOn ? member?.participantId : null);
  // A guest holds secrets too, so the shelf follows whoever this device is
  // pulling as. No session is minted here — that happens on the pack screen,
  // where a card is actually at stake; the vault only ever reads.
  const actor = useSecretActor();
  const secrets = useMySecrets(actor);
  // The sets, purely for their names and their order — this says nothing about
  // what is inside one, so the vault's silence about unpulled cards holds.
  const collectionsFn = useServerFn(getSecretCollections);
  const collections = useQuery({
    queryKey: ["secret-collections"],
    queryFn: () => collectionsFn(),
    staleTime: 30 * 60_000,
  });
  // The whole league's trophies, because the same rows badge your card backs and
  // fill your shelf. Public data, so this is the one collection query on this
  // page that is not scoped to whoever is holding the phone.
  const allTrophies = useCollectionTrophies();
  // A guest has no trophies by design — they are banked by claim_guest_secrets
  // the moment a guest claims a player — so this reads the member id and not the
  // actor.
  const myTrophies = useMemo(
    () => trophiesFor(allTrophies.data?.trophies ?? [], member?.participantId ?? null),
    [allTrophies.data, member?.participantId],
  );
  const myCompleted = useMemo(
    () => completedIds(allTrophies.data?.trophies ?? [], member?.participantId ?? null),
    [allTrophies.data, member?.participantId],
  );
  const secretStatus = useSecretStatus(actor);
  // Off the actor rather than the member, same as the secrets above: a guest
  // builds a real streak too, and claim_guest_packs carries it over when they
  // finally put a name to the phone. StreakStatus is a Streak with the milestone
  // ladder bolted on, which is more than the header needs and costs nothing.
  const streakQuery = useStreakStatus(actor);
  const streak = streakQuery.data ?? null;
  // Whether an answer is still coming, which is what decides if the Today card
  // reserves the strip's slot. `isPending` alone would be true forever for a
  // device with no actor, where the query never runs at all — and that person
  // has no streak to wait for, so the slot should collapse rather than sit
  // empty above the shelves.
  const streakPending = !!actor && streakQuery.isPending;
  // Claiming a rung from home. The same hook the pack summary's button uses, so
  // a milestone cannot pay twice or show its reveal on two screens at once.
  const milestone = useMilestoneClaim(actor, streak);
  const offline = !useIsOnline();
  const pullCounts = useCardPullCounts(event?.id ?? null);
  // An index rather than the card itself: the sheet swipes between secrets, so it
  // needs to know where in the shelf the open one sits.
  //
  // And WHICH list that index is into, because there are now two. The shelves
  // swipe `visibleSecrets`, which is built from open shelves only — a secret
  // opened from the "new since" strip can easily be sitting in a rolled-up one,
  // and `indexOf` would answer -1 for it. One sheet with two sources rather than
  // two sheets: two dialogs could both believe they were open.
  //
  // The strip's list is SNAPSHOT rather than followed. Opening a card from the
  // strip also marks the strip seen, which empties it — and a sheet reading a live
  // list would lose the card out from under the person who just tapped it. The
  // shelves stay live (`cards: null`), because nothing about opening a shelf card
  // changes what is on that shelf.
  const [openSecret, setOpenSecret] = useState<{
    cards: OwnedSecret[] | null;
    index: number;
  } | null>(null);
  // Reorder mode. Off by default and never persisted: it is a thing you turn on
  // for a moment, not a preference — and while it is off a shelf header has one
  // job, which is what stops the arrows being mistapped for the chevron.
  const [rearranging, setRearranging] = useState(false);
  // Set on claim and never cleared, so a member on a new phone gets told where
  // their collection went instead of watching it silently vanish. Read in an
  // effect rather than during render: SSR has no localStorage, and a mismatched
  // first paint is exactly the bug use-photo-urls.ts is written around.
  const [wasMember, setWasMember] = useState(false);
  useEffect(() => {
    setWasMember(localStorage.getItem(WAS_MEMBER_KEY) === "1");
  }, []);

  const rarities = useMemo(() => rarityMap(bundle), [bundle]);

  // Off the bundle rather than off `rows`, which now needs the collection to sort
  // and cannot also be what the collection is asked about. The hook only ever
  // builds a Set from this, so the order the grid happens to be in is irrelevant.
  const rosterIds = useMemo(() => (bundle?.participants ?? []).map((p) => p.id), [bundle]);
  // The third argument is what stops a missing event locking the vault: with no
  // id the stats query never runs, so without it `mine.ready` never turns true
  // and every slot below renders face-down for good. It covers BOTH ways an id
  // fails to arrive — a read that broke, and a read that answered "no combine on"
  // — because the difference does not matter to a collection that is never going
  // to be reconciled against a server. `eventLoading` is the only part that
  // does: while it is true the answer is still coming.
  const mine = useMyCollection(event?.id ?? null, rosterIds, !event && !eventLoading);
  const collected = mine.collection;
  // A phone that has just signed in has no member token yet, so the collection
  // settles off the local store alone and the counter would state "0 collected"
  // as a fact while the account is still being linked. Folded into the one
  // `ready` flag rather than a second one, so the counters and the grid can
  // never disagree about whether the answer is known.
  const sync = useAccountSyncState();
  const ready = mine.ready && sync.status !== "syncing";
  /**
   * Whether the shelf below knows what it is drawing.
   *
   * BOTH answers, not just the collection's. `ready` says which cards are yours;
   * the bundle says which cards exist, and it arrives on its own schedule behind
   * a second request. Either one landing first showed its own wrong state for a
   * frame — a guest whose IndexedDB read beats the network got "No participants
   * yet" under a heading, then the whole grid — which is the shift the
   * placeholders exist to remove rather than to relocate.
   *
   * `loading` rather than "the bundle has not arrived", and the difference is
   * the whole out-of-season case: with no active combine the bundle query never
   * runs and never will, so an absent bundle would leave placeholders up for
   * good instead of saying there is nobody on the roster. `loading` is false the
   * moment both queries have settled, however they settled.
   */
  const shelfWaiting = !ready || eventLoading;

  /**
   * Whether a slot renders face-down — and the only thing the rarity sort is
   * allowed to ask, so a card always sorts as the thing it is drawn as.
   *
   * An unready frame is locked: `useMyCollection` hands out an empty collection
   * until the server reconciles, and locked→unlocked popping in is a reveal
   * while unlocked→locked is a leak. Same argument as the counters at
   * use-my-collection.ts:116.
   */
  const isLocked = useCallback((id: string) => !ready || !collected[id], [ready, collected]);

  const rows = useMemo(() => {
    const list = [...(bundle?.participants ?? [])];
    const byName = (a: (typeof list)[number]) => a.participant?.name ?? "";
    switch (sort) {
      case "shuffle":
        // Seeded, so a realtime bundle update during the combine doesn't silently
        // reorder the grid under the user's thumb.
        return shuffle(list, seededRng(`${event?.id ?? ""}:${shuffleSeed}`));
      case "newest": {
        // The date you FIRST pulled each card, newest first. There is no
        // per-copy timestamp anywhere — the schema records when a card was first
        // pulled and nothing about the second — so this is "recently discovered"
        // and not "recently acquired", which is what §12 wants a server function
        // for and does not have yet.
        //
        // A locked slot has no date at all and sorts last, on the same rule as
        // the rarity sentinel below: a sort that floated the unpulled cards to
        // one end would be telling you which they are.
        const pulled = (p: (typeof list)[number]) =>
          isLocked(p.id) ? -1 : (collected[p.id]?.pulledAt ?? 0);
        return list.sort((a, b) => pulled(b) - pulled(a) || byName(a).localeCompare(byName(b)));
      }
      case "order":
        return list.sort((a, b) => a.running_order - b.running_order);
      case "pick":
        return list.sort(
          (a, b) =>
            (a.selected_draft_position ?? Number.MAX_SAFE_INTEGER) -
            (b.selected_draft_position ?? Number.MAX_SAFE_INTEGER),
        );
      case "rarity": {
        // Straight off `isLocked`, never gated on `mine.ready` from outside it.
        // Gating looked like it protected the settling grid and did the opposite:
        // while the collection reconciles every card is face-down, so a gate made
        // every card sort on its *real* rank and put the champion first under
        // eighteen identical backs — the sort itself becoming the leak the
        // sentinel exists to close, for as long as the round trip took.
        //
        // Asking the render's own question instead means an unready grid is one
        // flat bucket in name order. It still settles once when the answer lands,
        // and that is the honest cost: the alternative is holding the whole grid
        // back until then, and a card you already own is not a spoiler.
        const rank = (p: (typeof list)[number]) =>
          isLocked(p.id) ? LOCKED_RARITY_RANK : (rarities.get(p.id)?.rank ?? 9);
        // The finish breaks ties *inside* a tier and never above it: a platinum
        // DNF must not outrank a base champion. The tier is what somebody did on
        // the course; the finish is only how lucky the copy is.
        //
        // Nothing leaks. A locked card sorts as standard alongside the sentinel
        // rank above, and you only know the finish of cards you already hold.
        const finish = (p: (typeof list)[number]) =>
          isLocked(p.id) ? editionRank(LOCKED_EDITION) : editionRank(collected[p.id]?.edition);
        return list.sort(
          (a, b) =>
            rank(a) - rank(b) || finish(a) - finish(b) || byName(a).localeCompare(byName(b)),
        );
      }
      default:
        return list.sort((a, b) => byName(a).localeCompare(byName(b)));
    }
  }, [bundle, event?.id, sort, shuffleSeed, rarities, isLocked, collected]);

  /**
   * The roster the shelf actually draws.
   *
   * Filtering happens here and nowhere else — the Favourites shelf is a shelf you
   * built by hand and a filter must not empty it, and the secret shelves have no
   * "missing" to speak of at all (that is the one thing this app never says).
   */
  const filterRoster = useCallback(
    (list: typeof rows) => {
      switch (filter) {
        case "owned":
          return list.filter((p) => !isLocked(p.id));
        case "missing":
          return list.filter((p) => isLocked(p.id));
        case "spares":
          return list.filter((p) => !isLocked(p.id) && (collected[p.id]?.count ?? 0) > 1);
        default:
          return list;
      }
    },
    [filter, isLocked, collected],
  );

  // The Today card turns this into an "Offer waiting" pill, and only above zero. The
  // Trade tab carries the same news permanently, but its dot is easy to miss
  // under a thumb on the screen you are already looking at.
  const tradeUnread = useTradeBadge();
  const packWaiting = secretWaiting(secretStatus.data);
  // Read, never written: dealing still belongs to the pack screen, which is what
  // keeps one pack a day one pack a day.
  //
  // `secretOwed`, NOT `packWaiting`, and the two are deliberately different
  // questions. The pack pulls its secret the moment it is torn, so `packWaiting`
  // — the ring on the button — goes false while the card is still sitting
  // face-down on the stand. Counting with it called a pack with an unturned
  // secret finished and took away the link back to it.
  const packProgress = usePackProgress(secretOwed(secretStatus.data));
  // The secret's reset is the only one the server vouches for; the device's own
  // midnight is the one the pack actually re-seals on. See TodayCard's prop doc —
  // these are two clocks and the fallback is the more accurate of the two.
  const nextPackAt = secretStatus.data?.resetsAt ?? nextLocalMidnight(packProgress.now);

  /**
   * What arrived since this device last looked (§12).
   *
   * ONE STABLE QUESTION TO THE SERVER — the last day — and the "since you looked"
   * part is a filter over the answer. See `acquisitionWindow` for why the narrower
   * question was the wrong one to ask; the short version is that tapping the strip
   * is what moves the last-visit instant, and the card page you land on needs the
   * same rows a moment later.
   *
   * The window is PINNED for the visit rather than recomputed off
   * `packProgress.now`: that clock ticks every second, and a window that moved with
   * it would mint a new query key every minute for an answer that cannot have
   * changed. `lastSeen` is null until the store has been read, and null again on a
   * device that has never stored one — which is the silent first visit, because
   * `isNewSince` answers false for everything against a null.
   */
  const lastSeen = useVaultLastSeen();
  const [since] = useState(() => acquisitionWindow(Date.now()));
  const acquisitions = useRecentAcquisitions(event?.id ?? null, since);

  const ownedSecrets = useMemo(() => secrets.data?.cards ?? [], [secrets.data]);
  const { ids: favouriteIds, isFavourite, toggle: toggleFavourite } = useVaultFavourites();

  /**
   * The pinned shelf, in the order things were pinned.
   *
   * Walks the stored ids rather than filtering the grids, because the grids are
   * in whatever order the sort put them and the shelf is meant to read in the
   * order you built it. An id that resolves to neither a roster row nor an owned
   * secret is skipped in silence: the card was traded away, or this device pinned
   * it against a different combine, and neither is worth an error state.
   *
   * Locked cards can never match — the star is only drawn on cards you own — so a
   * favourite you trade away simply stops appearing rather than pinning a
   * face-down slot to the top of the page.
   */
  type Pinned =
    | { kind: "roster"; key: string; row: (typeof rows)[number] }
    | { kind: "secret"; key: string; card: OwnedSecret };

  const favourites = useMemo(() => {
    const byRoster = new Map(
      rows.filter((p) => !isLocked(p.id)).map((p) => [rosterFavouriteId(p.id), p]),
    );
    const bySecret = new Map(ownedSecrets.map((s) => [secretFavouriteId(s.id), s]));
    const out: Pinned[] = [];
    for (const id of favouriteIds) {
      const row = byRoster.get(id);
      if (row) {
        out.push({ kind: "roster", key: id, row });
        continue;
      }
      const card = bySecret.get(id);
      if (card) out.push({ kind: "secret", key: id, card });
    }
    return out;
  }, [favouriteIds, rows, isLocked, ownedSecrets]);

  // A pinned card moves rather than appearing twice, so the shelves below are
  // what is left over.
  const pinnedIds = useMemo(() => new Set(favourites.map((f) => f.key)), [favourites]);
  const unpinnedRows = useMemo(
    () => rows.filter((p) => !pinnedIds.has(rosterFavouriteId(p.id))),
    [rows, pinnedIds],
  );
  const rosterRows = useMemo(() => filterRoster(unpinnedRows), [filterRoster, unpinnedRows]);

  // Only sets this person owns something from ever become a shelf. An empty
  // "Pets" header leaks the shape of the set they have not pulled yet, which is
  // the one thing the whole feature withholds — and a set whose every card is
  // pinned upstairs drops out here by exactly the same rule.
  /**
   * How many sets the secrets you hold came FROM.
   *
   * Its own grouping rather than `secretGroups.length` below, because that one
   * has the pinned cards taken out of it — and pinning a card does not un-visit
   * the set it came from. Never how many sets exist.
   */
  const secretSetCount = useMemo(
    () => groupBySecretCollection(ownedSecrets, collections.data?.collections).length,
    [ownedSecrets, collections.data],
  );

  const secretGroups = useMemo(
    () =>
      groupBySecretCollection(
        ownedSecrets.filter((s) => !pinnedIds.has(secretFavouriteId(s.id))),
        collections.data?.collections,
      ),
    [ownedSecrets, pinnedIds, collections.data],
  );

  const sections = useMemo(
    () => [
      // First in this array is top of the page by default: orderSections seeds
      // from the order sections are presented in. It stays movable like any other.
      ...(favourites.length > 0
        ? [
            {
              kind: "favourites" as const,
              id: FAVOURITES_SECTION,
              title: "Favourites",
              meta: favourites.length,
              items: favourites,
            },
          ]
        : []),
      // Above the sets themselves: the finished ones are the answer to what the
      // shelves below are asking.
      ...(myTrophies.length > 0
        ? [
            {
              kind: "trophies" as const,
              id: TROPHIES_SECTION,
              title: "Complete",
              meta: myTrophies.length,
              trophies: myTrophies,
            },
          ]
        : []),
      ...secretGroups.map((g) => ({
        kind: "secrets" as const,
        id: secretSectionId(g.id),
        title: g.id === null ? VAULT_UNSORTED_LABEL : g.label,
        // How many of this set you hold. Never a denominator — see the shelf below.
        meta: g.items.length,
        // The set's own colour when an admin has given it one, else the shared
        // secret green — which is what every shelf wore before sets had themes.
        accent: g.accent ?? SECRET_RARITY.accent,
        items: g.items,
      })),
      // Last by default: the roster is the one shelf you already know by heart,
      // so the sets you are collecting lead the page.
      {
        kind: "roster" as const,
        id: ROSTER_SECTION,
        title: "Roster",
        // "3 of 13" while a filter is on, so a shelf showing a subset never
        // reads as a shelf that has lost cards. A roster denominator is the one
        // this app has always been allowed: thirteen people, publicly.
        // Off the FILTER and not off the two lengths. "Owned" while you own
        // everything matches every card, and a bare count there would read as
        // the whole shelf while a filter was quietly on.
        meta:
          filter === "all" ? rosterRows.length : `${rosterRows.length} of ${unpinnedRows.length}`,
      },
    ],
    [favourites, myTrophies, rosterRows.length, unpinnedRows.length, filter, secretGroups],
  );

  const presentIds = useMemo(() => sections.map((x) => x.id), [sections]);
  const { order, collapsed, toggle, move } = useVaultLayout(presentIds);
  const sectionsById = useMemo(() => new Map(sections.map((x) => [x.id, x])), [sections]);

  /**
   * Take a finished-set plaque to the shelf holding that set's cards.
   *
   * The trophy is a badge, not a replacement for the cards, but it reads like one
   * when the only thing on screen under "Complete" is a medal — a player finished
   * Legacy Pets and reported his four cards had gone. So the plaque now points at
   * the shelf they are actually on.
   */
  const shelfRefs = useRef(new Map<string, HTMLDivElement | null>());
  const [flashed, setFlashed] = useState<string | null>(null);
  const reducedMotion = usePrefersReducedMotion();
  const shelfForTrophy = useCallback(
    (collection: string) => {
      const id = secretSectionId(collection);
      // No shelf when every card of the set is pinned upstairs, or the cards have
      // been traded away: the plaque stays a plain badge rather than a dead tap.
      return sectionsById.has(id) ? id : null;
    },
    [sectionsById],
  );
  const openShelf = useCallback(
    (id: string) => {
      if (collapsed.has(id)) toggle(id);
      setFlashed(id);
      // Across a frame, so an expanding shelf has laid out before we scroll to it.
      requestAnimationFrame(() => {
        shelfRefs.current.get(id)?.scrollIntoView({
          behavior: reducedMotion ? "auto" : "smooth",
          block: "start",
        });
      });
    },
    [collapsed, toggle, reducedMotion],
  );
  useEffect(() => {
    if (!flashed) return;
    const t = setTimeout(() => setFlashed(null), 1600);
    return () => clearTimeout(t);
  }, [flashed]);

  // The sheet swipes what is on screen, in the order it is on screen. It used to
  // swipe the flat newest-pull-first list while the grid was already grouped, so
  // the next card of a swipe was rarely the one to the right of the last — and
  // once the shelves can be rearranged, and secrets can be pinned out of them,
  // that gap only widens.
  const visibleSecrets = useMemo(
    () =>
      order.flatMap((id) => {
        // A rolled-up shelf is not on screen. Walking the whole order meant
        // swiping past the end of an open shelf landed on a card from a
        // closed one — which is the opposite of what the comment above
        // promises and what the gesture looks like it is doing.
        if (collapsed.has(id)) return [];
        const section = sectionsById.get(id);
        if (section?.kind === "secrets") return section.items;
        if (section?.kind === "favourites")
          return section.items.flatMap((f) => (f.kind === "secret" ? [f.card] : []));
        return [];
      }),
    [order, sectionsById, collapsed],
  );

  /**
   * The secrets the "new since" strip is showing, in the order it shows them.
   *
   * Its own list because the strip is not a shelf: `visibleSecrets` walks open
   * shelves, and a secret that arrived this morning is very often filed in one
   * that is rolled up. Resolved against `ownedSecrets` rather than built from the
   * acquisitions response, because the sheet wants a full OwnedSecret — the level,
   * the count, the people count — and every one of those numbers is already in
   * hand here. None of them comes from the new server function, which is what
   * keeps a counting number off that wire entirely.
   */
  const stripSecrets = useMemo(() => {
    const byId = new Map(ownedSecrets.map((c) => [c.id, c]));
    const seen = new Set<string>();
    const out: OwnedSecret[] = [];
    for (const a of acquisitions.data?.secrets ?? []) {
      if (!isNewSince(a.acquiredAt, lastSeen)) continue;
      // One tile per CARD. Two pulls of the same secret inside the window are one
      // arrival wearing a ×2, not two tiles of the same picture.
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      const owned = byId.get(a.id);
      // A pull whose card has not landed in getMySecrets yet — the two queries
      // settle independently — is skipped rather than half-drawn.
      if (owned) out.push(owned);
    }
    return out;
  }, [acquisitions.data, lastSeen, ownedSecrets]);

  /**
   * The strip itself, shaped for drawing.
   *
   * EVERY LABEL IS COMPUTED HERE, from the collection this page has already
   * reconciled: "×3" is `collected[id].count` for a roster card and
   * `OwnedSecret.count` for a secret. The server sends neither, and it must not —
   * a count on that response is one careless addition away from being a count of
   * the set. §12 asks for exactly these two predicates.
   */
  const newCards = useMemo<NewSinceItem[]>(() => {
    const data = acquisitions.data;
    // `ready` as well as the data: every roster label is a COPY COUNT off the
    // reconciled collection, and before that lands `collected` is empty. Drawing
    // then would label a card you hold three of as NEW, which is worse than
    // drawing the strip a beat later — and it is the label, not the tile, that
    // this whole row is for.
    if (!data || !ready) return [];

    // Both kinds in one list, ordered by when they landed. Concatenating them
    // instead put every roster tile ahead of every secret however they actually
    // interleaved, so a secret pulled after a trade still read as older.
    const entries: { at: string; item: NewSinceItem }[] = [];

    const seen = new Set<string>();
    for (const a of data.roster) {
      // The "since you looked" half, applied here rather than in the query: it is
      // what makes dismissing the strip instant and free, and what stops the open
      // secret sheet losing the card underneath it when somebody does.
      if (!isNewSince(a.acquiredAt, lastSeen)) continue;
      if (seen.has(a.eventParticipantId)) continue;
      seen.add(a.eventParticipantId);
      const p = bundle?.participants.find((x) => x.id === a.eventParticipantId);
      if (!p) continue;
      const copies = collected[a.eventParticipantId]?.count ?? 1;
      entries.push({
        at: a.acquiredAt,
        item: {
          kind: "roster",
          id: a.eventParticipantId,
          name: p.participant?.name ?? "—",
          urls: cards.data?.[a.eventParticipantId]?.front ?? null,
          rarity: rarities.get(a.eventParticipantId) ?? rarityStyle("base"),
          // The finish of THIS copy, which is the one that just arrived — not the
          // best one held, which is what the shelf tile wears.
          edition: toEdition(a.edition),
          label: copies > 1 ? `×${copies}` : "NEW",
        },
      });
    }

    const arrivedAt = new Map((data.secrets ?? []).map((a) => [a.id, a.acquiredAt]));
    for (const c of stripSecrets) {
      entries.push({
        at: arrivedAt.get(c.id) ?? "",
        item: {
          kind: "secret",
          id: c.id,
          name: c.name,
          artUrl: c.artUrl,
          rarity: secretFoil(c.foil, c.borderFx, c.tier),
          tier: c.tier,
          label: c.count > 1 ? `×${c.count}` : "NEW",
        },
      });
    }

    return entries.sort((a, b) => b.at.localeCompare(a.at)).map((e) => e.item);
  }, [acquisitions.data, bundle, cards.data, collected, lastSeen, rarities, ready, stripSecrets]);

  /** Acted on, so there is nothing new any more. A look alone never does this. */
  const dismissNew = useCallback(() => markVaultSeen(), []);

  const openNewCard = useCallback(
    (item: NewSinceItem) => {
      // Before opening, not after: a roster tap navigates away, and a write that
      // waited for the next render would never happen.
      const index = stripSecrets.findIndex((c) => c.id === item.id);
      // Snapshot before the mark, because the mark is what empties `stripSecrets`.
      if (item.kind === "secret" && index >= 0) {
        setOpenSecret({ cards: stripSecrets, index });
      }
      markVaultSeen();
    },
    [stripSecrets],
  );

  /**
   * A finished set, as a plaque rather than a card.
   *
   * Deliberately not a HoloCard: a set is not a card, and drawing it as one puts
   * a fourteenth thing on a shelf of thirteen. The size is printed here and
   * nowhere else on this page — this is the one shelf entitled to a denominator,
   * because it only ever describes something already finished.
   */
  const trophyTile = (t: CollectionTrophy) => {
    const shelf = shelfForTrophy(t.collection);
    const body = (
      <>
        <Medal
          aria-hidden
          className="h-9 w-9"
          style={{ color: TROPHY_RARITY.accent, filter: "drop-shadow(0 0 10px currentColor)" }}
        />
        <div className="truncate font-display text-xs font-black uppercase tracking-wide">
          {t.label}
        </div>
        <div
          className="text-badge font-bold uppercase tracking-[0.08em]"
          style={{ color: TROPHY_RARITY.accent }}
        >
          {trophySizeLabel(t.size)}
        </div>
        {/* Backfilled trophies carry the day this table came into existence, not the
          day the set was finished — nothing in the schema records when a given
          person acquired a given card, and a traded row keeps the GIVER's pull
          date. Better to say nothing than to state a date the data cannot
          support, and better than eight people appearing to finish the same
          afternoon. */}
        {t.via !== "backfill" && (
          <div className="text-meta font-semibold text-muted-foreground">
            {formatDay(t.completedOn)}
          </div>
        )}
        {shelf && (
          <div className="text-label font-bold uppercase tracking-[0.08em] text-muted-foreground">
            View set
          </div>
        )}
      </>
    );
    const shell =
      "hud-bezel flex aspect-[3/4] w-full flex-col items-center justify-center gap-2 rounded-xl border p-3 text-center";
    if (!shelf) {
      return (
        <div key={t.collection} className={shell} style={{ borderColor: TROPHY_RARITY.border }}>
          {body}
        </div>
      );
    }
    return (
      <button
        key={t.collection}
        type="button"
        onClick={() => openShelf(shelf)}
        aria-label={`Show your ${t.label} cards`}
        className={cn(shell, "transition-transform hover:scale-[1.02] active:scale-[0.99]")}
        style={{ borderColor: TROPHY_RARITY.border }}
      >
        {body}
      </button>
    );
  };

  const secretTile = (s: OwnedSecret) => {
    const rarity = secretFoil(s.foil, s.borderFx, s.tier);
    const favourite = secretFavouriteId(s.id);
    return (
      <div key={s.id} className="flex flex-col gap-2">
        <div className="relative">
          <HoloCard
            frontUrl={s.artUrl}
            backUrl={null}
            name={s.name}
            rarity={rarity}
            intensity="subtle"
            interactive={false}
            onClick={() => setOpenSecret({ cards: null, index: visibleSecrets.indexOf(s) })}
          />
          <FavouriteButton
            name={s.name}
            on={isFavourite(favourite)}
            onToggle={() => toggleFavourite(favourite)}
            className="absolute right-0 top-0"
          />
        </div>
        <div className="text-center">
          <div className="truncate font-display text-card-name font-black uppercase tracking-wide">
            {s.name}
          </div>
          {/* The level of your copy leads, in its own colour — the same
              hierarchy a special finish takes on a roster tile. The pips go
              above the word rather than below it because at this size they are
              the thing that is actually read. */}
          <LevelPips tier={s.tier} className="mt-0.5" />
          <div
            className="text-badge font-bold uppercase tracking-[0.08em]"
            style={{ color: secretTierStyle(s.tier).accent }}
          >
            {secretTierCaption(s.tier)}
          </div>
          <div className="text-meta font-semibold" style={{ color: rarity.border }}>
            {/* Same vocabulary as card-slab.tsx, so the two halves of the
                collection speak the same language. */}
            {s.count > 1 ? `Pulled ×${s.count}` : "Secret"}
          </div>
          {packedByLabel(s.ownerCount) && (
            <div className="text-meta font-semibold text-muted-foreground">
              {packedByLabel(s.ownerCount)}
            </div>
          )}
        </div>
      </div>
    );
  };

  const rosterTile = (p: (typeof rows)[number]) => {
    const urls = cards.data?.[p.id];
    const rarity = rarities.get(p.id) ?? rarityStyle("base");
    const name = p.participant?.name ?? "—";
    const locked = isLocked(p.id);
    const copies = collected[p.id]?.count ?? 0;
    const favourite = rosterFavouriteId(p.id);
    const tileBadge = cardBadge(
      { label: rarity.label, reason: "", accent: rarity.accent },
      locked ? "standard" : toEdition(collected[p.id]?.edition),
    );
    return (
      <div key={p.id} className="relative">
        <Link to="/players/$id" params={{ id: p.id }} className="group block focus:outline-none">
          {/* Its own positioned box, so the pip below sits on the CARD rather
              than at the bottom of the caption under it. */}
          <div className="relative">
            {/* The link survives the lock: the detail page is gated too, and
                it is where someone finds out what they are missing. */}
            {locked ? (
              <LockedCard
                back={cardBack.data?.urls ?? null}
                name={name}
                inGrid
                className="transition-transform group-hover:scale-[1.02]"
              />
            ) : (
              <HoloCard
                frontUrl={urls?.front ?? null}
                backUrl={null}
                name={name}
                rarity={rarity}
                // The finish belongs to your copy, so it comes from the
                // collection, not the roster row. Same expression the label
                // below uses — the two must never disagree. It is already the
                // best copy you hold: resync_card_pull writes card_pulls.edition
                // as the top-ranked edition across every row in card_copies.
                edition={toEdition(collected[p.id]?.edition)}
                intensity="subtle"
                className="transition-transform group-hover:scale-[1.02]"
              />
            )}
            {/* The physical stack cue, and the one number that makes a card
                TRADEABLE — until now it appeared only on secrets and on the
                detail slab, which is nowhere near where trading decisions start
                (§5). Never on a locked slot: there is no copy to count, and a
                pip there would say the slot is yours. */}
            {!locked && copies > 1 && (
              <span
                className="absolute bottom-1 right-1 rounded-full bg-background/85 px-1.5 py-0.5 text-badge font-black leading-none tabular-nums text-primary ring-1 ring-primary/40"
                aria-label={`${copies} copies`}
              >
                ×{copies}
              </span>
            )}
          </div>
          <div className="mt-2 text-center">
            <div className="truncate font-display text-sm font-black uppercase tracking-wide text-foreground group-hover:text-primary">
              {name}
            </div>
            {/* A tick, not a word: the label is the line's real content,
                and the set only fills in a card at a time. On a special
                finish that label is the metal, in its own colour, with the
                tier demoted to the muted line under it — see cardBadge. */}
            <div className="flex items-center justify-center gap-1">
              {!locked && (
                <Check className="h-3 w-3 shrink-0 text-primary" aria-label="Collected" />
              )}
              <span
                className="text-badge font-bold uppercase tracking-[0.08em]"
                style={{
                  color: locked
                    ? undefined
                    : !urls?.front
                      ? undefined
                      : tileBadge.isEdition
                        ? tileBadge.color
                        : rarity.tier === "base"
                          ? undefined
                          : rarity.border,
                }}
              >
                {locked ? "Not packed yet" : urls?.front ? tileBadge.headline : "No card yet"}
              </span>
            </div>
            {/* The league's number, not yours. Its own line and muted, so
                it never reads as one statement with the tick above it —
                that tick is "you have this", this is "they do". */}
            {packedByLabel(pullCounts.data?.[p.id]) && (
              <div className="text-meta font-semibold text-muted-foreground">
                {packedByLabel(pullCounts.data?.[p.id])}
              </div>
            )}
          </div>
        </Link>
        {/* A sibling of the Link, never a child: nested, every tap to pin a card
            would navigate to that card's page as well. Same lesson as the move
            buttons in vault-section.tsx. Not drawn on a locked slot — you cannot
            pin a card you have not seen, and there would be no copy to show. */}
        {!locked && (
          <FavouriteButton
            name={name}
            on={isFavourite(favourite)}
            onToggle={() => toggleFavourite(favourite)}
            className="absolute right-0 top-0"
          />
        )}
      </div>
    );
  };

  /**
   * Every shelf, at whatever size this device reads at.
   *
   * The density is deliberately not roster-only even though its control lives on
   * the roster's header: it is how big you like cards, and a binder whose pages
   * were different sizes would be a strange binder. Only the phone breakpoint
   * moves — above `sm` there is room for three or four either way.
   */
  const cardGrid = (tiles: React.ReactNode) => (
    <div
      className={cn(
        "grid gap-4 sm:grid-cols-3 lg:grid-cols-4",
        density === 3 ? "grid-cols-3" : "grid-cols-2",
      )}
    >
      {tiles}
    </div>
  );

  /**
   * Why the roster shelf is empty, when it is.
   *
   * A filter that matched nothing is not the same as a shelf whose cards are all
   * pinned upstairs, and neither is "you have not packed anything" — each has a
   * different next move, so each gets its own sentence.
   */
  const emptyRosterLine =
    unpinnedRows.length === 0
      ? "Every card is pinned to Favourites."
      : // Matches upstairs but not down here: the cards this filter is asking
        // for exist, they are just all on the Favourites shelf. "No spares yet"
        // would be a flat lie to somebody who has just pinned their only spare.
        filterRoster(rows).length > 0
        ? "Every matching card is pinned to Favourites."
        : filter === "spares"
          ? "No spares yet. A second copy of a card turns up here."
          : filter === "missing"
            ? "Nothing missing — you have packed every card."
            : filter === "owned"
              ? "Nothing packed yet. Open today's pack."
              : "Every card is pinned to Favourites.";

  const rosterBody = (
    <>
      {/* Four states, in the order they can be true. Placeholders come first and
          cover the wait `shelfWaiting` describes above — every slot face-down
          because the answer is not in yet rather than because the card is
          unpulled; drawing the backs through it and popping the owned ones open
          is a reveal in the wrong place (see card-skeleton.tsx). After that, an
          empty roster, a roster whose every card is pinned upstairs and a filter
          that matched nothing look identical in the markup and mean three
          different things, so they stay separate states rather than one shrug. */}
      {shelfWaiting ? (
        <>
          <p role="status" className="sr-only">
            Counting your collection…
          </p>
          {cardGrid(
            Array.from({ length: rows.length || SKELETON_TILES }, (_, i) => (
              <CardSkeleton key={i} />
            )),
          )}
        </>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground">
          <Layers className="h-6 w-6 opacity-50" />
          No participants yet.
        </div>
      ) : rosterRows.length === 0 ? (
        <p className="p-6 text-center text-xs text-muted-foreground">{emptyRosterLine}</p>
      ) : (
        cardGrid(rosterRows.map(rosterTile))
      )}
    </>
  );

  // The vault's own summary, under the card that says what to do next. One line
  // instead of the four-counter stack: how much of the ROSTER you hold (public,
  // so a fraction is fine), how many secrets you have found and across how many
  // sets — never how many exist — and how many sets you have finished.
  const summary = ready
    ? vaultSummaryLine({
        rosterHeld: mine.collectedCount,
        rosterSize: rows.length,
        secrets: secrets.data?.pulled ?? 0,
        sets: secretSetCount,
        complete: myTrophies.length,
      })
    : null;

  // A claim's reveal takes the whole screen the way the pack's ceremony does, so
  // it claims the chrome the same way.
  const presenting = milestone.milestoneReveal !== null;

  return (
    <div className="card-bg min-h-[calc(100dvh-8rem)]">
      <div className="mx-auto max-w-6xl px-4 py-6">
        {/* The same banner five other screens show. This one watches the event
          channel too and said nothing at all when it went down — a frozen
          screen with no signal is the exact failure the health states exist
          for. Silent while a reveal has the screen, as on the pack. */}
        {!presenting && (realtimeDegraded || !!error) && <FeedDegradedBanner className="mb-4" />}
        <PresentationMode active={presenting} />
        <PresentationStage active={presenting} />
        {/* A sibling of the stage, never inside it: `backdrop-filter` is a
            grouping property and flattens the 3D the card turns in. Same
            arrangement as players.pack.tsx, for the same reason. */}
        {milestone.milestoneReveal && (
          <MilestoneReveal
            milestone={milestone.milestoneReveal.milestone}
            streak={milestone.milestoneReveal.streak}
            card={milestone.milestoneReveal.card}
            tierFloor={milestone.milestoneReveal.tierFloor}
            duplicate={milestone.milestoneReveal.duplicate}
            universalBack={urlFromSet(cardBack.data?.urls) ? (cardBack.data?.urls ?? null) : null}
            onDone={milestone.dismiss}
          />
        )}

        {/* Signed in with no player yet: their pulls are filed against this
            handset and nobody can trade with them until they name themselves.
            The vault is where they land, so it is where the prompt belongs. */}
        <CollectorSignupGate className="mb-5" />
        <VaultHero
          dustOn={dustOn}
          dustBalance={dust.data?.balance}
          isMember={!!member}
          wasMember={wasMember}
          syncError={sync.status === "error" ? sync.message : null}
        />

        <TodayCard
          pack={packProgress}
          packWaiting={packWaiting}
          nextPackAt={nextPackAt}
          now={packProgress.now}
          streak={streak}
          streakPending={streakPending}
          claimable={milestone.claimable}
          canClaim={streak?.canClaim ?? false}
          claiming={milestone.claiming}
          claimError={milestone.claimError}
          offline={offline}
          onClaim={() => {
            if (milestone.claimable) void milestone.claim(milestone.claimable.days);
          }}
          tradeUnread={tradeUnread}
          newCards={newCards}
          onOpenNewCard={openNewCard}
          onDismissNew={dismissNew}
        />

        {/* Reserved whether or not the collection has reconciled, so the shelves
            below do not step down by a line when it does. */}
        <p className="mb-4 min-h-4 text-xs text-muted-foreground">{summary}</p>

        <SecretCardSheet
          cards={openSecret?.cards ?? visibleSecrets}
          index={openSecret?.index ?? null}
          // The list travels with the index, so a swipe out of a card opened from
          // the strip keeps swiping the strip rather than jumping into the shelves
          // halfway through.
          onIndexChange={(index) =>
            setOpenSecret((prev) => ({ cards: prev?.cards ?? null, index }))
          }
          onOpenChange={(open) => !open && setOpenSecret(null)}
          completedCollections={myCompleted}
        />

        <VaultSortSheet
          open={sortSheetOpen}
          onOpenChange={setSortSheetOpen}
          sort={sort}
          onSort={(next: VaultSort) => {
            setSort(next);
            // Pressing Shuffle again is a NEW order, not a no-op — which is the
            // one way this control differs from the other five.
            if (next === "shuffle") setShuffleSeed(newSeed());
          }}
          filter={filter}
          onFilter={setFilter}
          density={density}
          onDensity={setDensity}
          rearranging={rearranging}
          onRearranging={setRearranging}
        />

        {/* Secrets keep shelves of their own rather than being interleaved into
            the roster: every roster sort reads a field a secret does not have,
            and editorially a secret is not a roster card. Now that the shelves
            sit as peers, the accent on their headers is what says so. Nothing is
            rendered at zero — no header, no slots, no silhouettes. An unpulled
            secret is not "missing", it is unknown. */}
        {order.map((id, i) => {
          const section = sectionsById.get(id);
          if (!section) return null;
          return (
            // Scroll target for the Complete plaques, plus a brief ring so it is
            // obvious which shelf you just landed on.
            <div
              key={id}
              ref={(el) => {
                shelfRefs.current.set(id, el);
              }}
              className={cn(
                "scroll-mt-4 rounded-xl transition-shadow",
                flashed === id && "ring-2 ring-primary/60",
              )}
            >
              <VaultSection
                title={section.title}
                meta={section.meta}
                accent={section.kind === "secrets" ? section.accent : undefined}
                open={!collapsed.has(id)}
                onOpenChange={() => toggle(id)}
                canMoveUp={i > 0}
                canMoveDown={i < order.length - 1}
                onMove={(delta) => move(id, delta)}
                rearranging={rearranging}
                // The one control the sort sheet is behind, on the shelf it
                // sorts. In the page header it would sit above a shelf that can
                // be rolled up, controlling nothing you can see.
                action={
                  section.kind === "roster" ? (
                    <VaultSortChip
                      onOpen={() => setSortSheetOpen(true)}
                      active={sort !== "name" || filter !== "all" || density !== 2}
                    />
                  ) : undefined
                }
              >
                {section.kind === "roster"
                  ? rosterBody
                  : section.kind === "trophies"
                    ? cardGrid(section.trophies.map(trophyTile))
                    : section.kind === "favourites"
                      ? // Both kinds of card land on one shelf, each drawn by the
                        // renderer it would have had downstairs, so a pinned card
                        // looks like itself rather than like a third thing.
                        cardGrid(
                          section.items.map((f) =>
                            f.kind === "roster" ? rosterTile(f.row) : secretTile(f.card),
                          ),
                        )
                      : cardGrid(section.items.map(secretTile))}
              </VaultSection>
            </div>
          );
        })}
      </div>
    </div>
  );
}
