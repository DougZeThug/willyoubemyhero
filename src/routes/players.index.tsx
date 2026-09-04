import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Shuffle, Layers, Check, ArrowUpDown, Medal } from "lucide-react";
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
import { FavouriteButton } from "@/components/favourite-button";
import { LevelPips } from "@/components/level-pips";
import {
  groupBySecretCollection,
  secretFoil,
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
import { seededRng, shuffle } from "@/lib/format";
import { CollectorSignupGate } from "@/components/collector-signup";
import { cn } from "@/lib/utils";
import { FeedDegradedBanner } from "@/components/feed-state";
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";
import { useAccountSyncState } from "@/lib/account-sync-state";

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

type SortKey = "name" | "order" | "pick" | "rarity";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "order", label: "Order" },
  { key: "pick", label: "Pick" },
  { key: "rarity", label: "Rarity" },
];

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
  const [sort, setSort] = useState<SortKey>("name");
  const [shuffleSeed, setShuffleSeed] = useState(0);
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
  const streak = useStreakStatus(actor).data ?? null;
  const pullCounts = useCardPullCounts(event?.id ?? null);
  // An index rather than the card itself: the sheet swipes between secrets, so it
  // needs to know where in the shelf the open one sits.
  const [openSecret, setOpenSecret] = useState<number | null>(null);
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
    // Seeded, so a realtime bundle update during the combine doesn't silently
    // reorder the grid under the user's thumb.
    if (shuffleSeed > 0) return shuffle(list, seededRng(`${event?.id ?? ""}:${shuffleSeed}`));
    const byName = (a: (typeof list)[number]) => a.participant?.name ?? "";
    switch (sort) {
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

  const withCards = rows.filter((p) => cards.data?.[p.id]?.front).length;
  // The hero turns this into an "Offer waiting" pill, and only above zero. The
  // Trade tab carries the same news permanently, but its dot is easy to miss
  // under a thumb on the screen you are already looking at.
  const tradeUnread = useTradeBadge();
  const packWaiting = secretWaiting(secretStatus.data);

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
  const rosterRows = useMemo(
    () => rows.filter((p) => !pinnedIds.has(rosterFavouriteId(p.id))),
    [rows, pinnedIds],
  );

  // Only sets this person owns something from ever become a shelf. An empty
  // "Pets" header leaks the shape of the set they have not pulled yet, which is
  // the one thing the whole feature withholds — and a set whose every card is
  // pinned upstairs drops out here by exactly the same rule.
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
      { kind: "roster" as const, id: ROSTER_SECTION, title: "Roster", meta: rosterRows.length },
    ],
    [favourites, myTrophies, rosterRows.length, secretGroups],
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
            onClick={() => setOpenSecret(visibleSecrets.indexOf(s))}
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
    const favourite = rosterFavouriteId(p.id);
    const tileBadge = cardBadge(
      { label: rarity.label, reason: "", accent: rarity.accent },
      locked ? "standard" : toEdition(collected[p.id]?.edition),
    );
    return (
      <div key={p.id} className="relative">
        <Link to="/players/$id" params={{ id: p.id }} className="group block focus:outline-none">
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

  const cardGrid = (tiles: React.ReactNode) => (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">{tiles}</div>
  );

  const rosterBody = (
    <>
      {/* Sits with the grid it sorts. Left in the page header it would strand
          above a shelf that is rolled up, controlling nothing you can see. */}
      {/* The active chip was a colour swap and nothing else, so a screen reader
          heard four identical controls and no answer to "sorted by what".
          aria-pressed rather than a radiogroup: it says the same thing, matches
          the Rearrange toggle below, and keeps these as buttons — the e2e suite
          reaches them by role, and role="radio" made them vanish from it. */}
      <div className="mb-3 flex items-center gap-1">
        {/* A scroller, because the five controls genuinely do not fit: at 44px
            and 12px the four chips measure 293px against 262px of shelf at
            320px wide. Same treatment as the card strips — the row stays one
            row and every chip stays reachable, rather than wrapping into a
            second 44px band on a screen the audit already faults for spending
            640px above the first card (§17). */}
        <div
          role="group"
          aria-label="Sort the roster"
          className="-mx-1 flex min-w-0 items-center gap-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {SORTS.map((s) => (
            <button
              key={s.key}
              aria-pressed={sort === s.key && shuffleSeed === 0}
              onClick={() => {
                setSort(s.key);
                setShuffleSeed(0);
              }}
              className={cn(
                "inline-flex min-h-11 shrink-0 items-center rounded-md px-2.5 text-label font-bold uppercase tracking-[0.08em] transition-colors",
                sort === s.key && shuffleSeed === 0
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
        {/* The word drops below sm so all five controls hold one row at 320px.
            Losing it costs nothing a label does not already carry, and a second
            44px row would cost more than the word is worth on a screen that
            already spends 640px above the first card. */}
        <button
          aria-pressed={shuffleSeed > 0}
          aria-label="Shuffle the roster"
          onClick={() => setShuffleSeed((n) => n + 1)}
          className={cn(
            "ml-auto inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-md px-3 text-label font-bold uppercase tracking-[0.08em] transition-colors",
            shuffleSeed > 0
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
          )}
        >
          <Shuffle className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Shuffle</span>
        </button>
      </div>

      {/* Four states, in the order they can be true. Placeholders come first and
          cover the wait `shelfWaiting` describes above — every slot face-down
          because the answer is not in yet rather than because the card is
          unpulled; drawing the backs through it and popping the owned ones open
          is a reveal in the wrong place (see card-skeleton.tsx). After that, an
          empty roster and a roster whose every card is pinned upstairs look
          identical in the markup and mean opposite things, so they stay two
          separate states rather than one shrug. */}
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
        <p className="p-6 text-center text-xs text-muted-foreground">
          Every card is pinned to Favourites.
        </p>
      ) : (
        cardGrid(rosterRows.map(rosterTile))
      )}
    </>
  );

  return (
    <div className="card-bg min-h-[calc(100dvh-8rem)]">
      <div className="mx-auto max-w-6xl px-4 py-6">
        {/* The same banner five other screens show. This one watches the event
          channel too and said nothing at all when it went down — a frozen
          screen with no signal is the exact failure the health states exist
          for. */}
        {(realtimeDegraded || !!error) && <FeedDegradedBanner className="mb-4" />}

        {/* Signed in with no player yet: their pulls are filed against this
            handset and nobody can trade with them until they name themselves.
            The vault is where they land, so it is where the prompt belongs. */}
        <CollectorSignupGate className="mb-5" />
        <VaultHero
          printed={withCards}
          rosterSize={rows.length}
          ready={ready}
          collectedCount={mine.collectedCount}
          packsOpened={mine.packsOpened}
          secretsPulled={secrets.data?.pulled ?? 0}
          dustOn={dustOn}
          dustBalance={dust.data?.balance}
          isMember={!!member}
          wasMember={wasMember}
          syncError={sync.status === "error" ? sync.message : null}
          streak={streak}
          packWaiting={packWaiting}
          tradeUnread={tradeUnread}
        />

        <SecretCardSheet
          cards={visibleSecrets}
          index={openSecret}
          onIndexChange={setOpenSecret}
          onOpenChange={(open) => !open && setOpenSecret(null)}
          completedCollections={myCompleted}
        />

        {/* One toggle for the whole vault, rather than arrows living permanently
            beside every collapse header. */}
        {order.length > 1 && (
          <div className="mb-2 flex justify-end">
            <button
              type="button"
              aria-pressed={rearranging}
              onClick={() => setRearranging((v) => !v)}
              className={cn(
                "inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 text-label font-bold uppercase tracking-[0.08em] transition-colors",
                rearranging
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
              )}
            >
              <ArrowUpDown className="h-3.5 w-3.5" />
              {rearranging ? "Done" : "Rearrange"}
            </button>
          </div>
        )}

        {/* Secrets keep shelves of their own rather than being interleaved into
            the roster: every SortKey branch reads a field a secret does not have,
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
