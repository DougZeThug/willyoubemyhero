import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Users, Shuffle, PackageOpen, Layers, Award, ArrowLeftRight, Check, UserRoundCheck } from "lucide-react"; // prettier-ignore
import { useEventBundle } from "@/hooks/use-event-bundle";
import { useEventCardBack, useEventCardUrls } from "@/hooks/use-photo-urls";
import { HoloCard } from "@/components/holo-card";
import { LOCKED_EDITION, LockedCard } from "@/components/locked-card";
import { rarityMap, rarityStyle } from "@/lib/card-rarity";
import { cardBadge, editionRank, toEdition } from "@/lib/card-edition";
import { useMemberSession, WAS_MEMBER_KEY } from "@/lib/member-token";
import { useMySecrets, useSecretActor, useSecretStatus } from "@/hooks/use-daily-secret";
import { useCardPullCounts } from "@/hooks/use-card-pulls";
import { useMyCollection } from "@/hooks/use-my-collection";
import { packedByLabel, packsOpenedLabel } from "@/lib/card-pulls";
import { SecretCardSheet } from "@/components/secret-card-sheet";
import { VaultSection } from "@/components/vault-section";
import {
  groupBySecretCollection,
  secretFoil,
  secretsPulledLabel,
  SECRET_RARITY,
  VAULT_UNSORTED_LABEL,
  type OwnedSecret,
} from "@/lib/secret-cards";
import { ROSTER_SECTION, secretSectionId, useVaultLayout } from "@/lib/vault-layout";
import { secretTierCaption, secretTierStyle } from "@/lib/secret-rarity";
import { seededRng, shuffle } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/players/")({
  head: () => ({
    meta: [
      { title: "The Vault — Will YOU Be My Hero? Draft Combine" },
      {
        name: "description",
        content: "Every combine athlete's trading card. Tilt them, flip them, collect the set.",
      },
      { property: "og:title", content: "Will YOU Be My Hero? Draft Combine — The Vault" },
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

function PlayersPage() {
  const { event, bundle } = useEventBundle();
  const cards = useEventCardUrls(event?.id ?? null);
  // Hoisted once for the whole grid, and the *event's* back rather than each
  // player's — see the note on useEventCardBack. A player's own back on their
  // locked slot would be half the reveal, printed on the thing hiding it.
  const cardBack = useEventCardBack(event?.id ?? null);
  const [sort, setSort] = useState<SortKey>("name");
  const [shuffleSeed, setShuffleSeed] = useState(0);
  const member = useMemberSession();
  // A guest holds secrets too, so the shelf follows whoever this device is
  // pulling as. No session is minted here — that happens on the pack screen,
  // where a card is actually at stake; the vault only ever reads.
  const actor = useSecretActor();
  const secrets = useMySecrets(actor);
  const secretStatus = useSecretStatus(actor);
  const pullCounts = useCardPullCounts(event?.id ?? null);
  // An index rather than the card itself: the sheet swipes between secrets, so it
  // needs to know where in the shelf the open one sits.
  const [openSecret, setOpenSecret] = useState<number | null>(null);
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
  const mine = useMyCollection(event?.id ?? null, rosterIds);
  const collected = mine.collection;

  /**
   * Whether a slot renders face-down — and the only thing the rarity sort is
   * allowed to ask, so a card always sorts as the thing it is drawn as.
   *
   * An unready frame is locked: `useMyCollection` hands out an empty collection
   * until the server reconciles, and locked→unlocked popping in is a reveal
   * while unlocked→locked is a leak. Same argument as the counters at
   * use-my-collection.ts:116.
   */
  const isLocked = useCallback(
    (id: string) => !mine.ready || !collected[id],
    [mine.ready, collected],
  );

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
  const secretWaiting = !!secretStatus.data?.claimed && !secretStatus.data.pulledToday && secretStatus.data.available; // prettier-ignore

  // Only sets this person owns something from ever become a shelf. An empty
  // "Pets" header leaks the shape of the set they have not pulled yet, which is
  // the one thing the whole feature withholds.
  //
  // The `?? []` lives inside the memo: hoisted out it is a fresh array on every
  // render while the query is still loading, and every memo downstream of this
  // one — the section list, the order, the sheet's card list — would rebuild with
  // it.
  const secretGroups = useMemo(
    () => groupBySecretCollection(secrets.data?.cards ?? []),
    [secrets.data],
  );

  const sections = useMemo(
    () => [
      { kind: "roster" as const, id: ROSTER_SECTION, title: "Roster", meta: rows.length },
      ...secretGroups.map((g) => ({
        kind: "secrets" as const,
        id: secretSectionId(g.id),
        title: g.id === null ? VAULT_UNSORTED_LABEL : g.label,
        // How many of this set you hold. Never a denominator — see the shelf below.
        meta: g.items.length,
        items: g.items,
      })),
    ],
    [rows.length, secretGroups],
  );

  const presentIds = useMemo(() => sections.map((x) => x.id), [sections]);
  const { order, collapsed, toggle, move } = useVaultLayout(presentIds);
  const sectionsById = useMemo(() => new Map(sections.map((x) => [x.id, x])), [sections]);

  // The sheet swipes what is on screen, in the order it is on screen. It used to
  // swipe the flat newest-pull-first list while the grid was already grouped, so
  // the next card of a swipe was rarely the one to the right of the last — and
  // once the shelves can be rearranged that gap only widens.
  const visibleSecrets = useMemo(
    () =>
      order.flatMap((id) => {
        const section = sectionsById.get(id);
        return section?.kind === "secrets" ? section.items : [];
      }),
    [order, sectionsById],
  );

  const secretGrid = (items: OwnedSecret[]) => (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((s) => {
        const rarity = secretFoil(s.foil, s.borderFx);
        return (
          <div key={s.id} className="flex flex-col gap-2">
            <HoloCard
              frontUrl={s.artUrl}
              backUrl={null}
              name={s.name}
              rarity={rarity}
              intensity="subtle"
              interactive={false}
              onClick={() => setOpenSecret(visibleSecrets.indexOf(s))}
            />
            <div className="text-center">
              <div className="truncate font-display text-xs font-black uppercase tracking-wide">
                {s.name}
              </div>
              {/* The level of your copy leads, in its own colour — the same
                  hierarchy a special finish takes on a roster tile. */}
              <div
                className="text-[9px] font-bold uppercase tracking-[0.25em]"
                style={{ color: secretTierStyle(s.tier).accent }}
              >
                {secretTierCaption(s.tier)}
              </div>
              <div
                className="text-[9px] font-bold uppercase tracking-[0.25em]"
                style={{ color: rarity.border }}
              >
                {/* Same vocabulary as card-slab.tsx, so the two halves of the
                    collection speak the same language. */}
                {s.count > 1 ? `Pulled ×${s.count}` : "Secret"}
              </div>
              {packedByLabel(s.ownerCount) && (
                <div className="text-[9px] font-bold uppercase tracking-[0.25em] text-muted-foreground">
                  {packedByLabel(s.ownerCount)}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );

  const rosterBody = (
    <>
      {/* Sits with the grid it sorts. Left in the page header it would strand
          above a shelf that is rolled up, controlling nothing you can see. */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {SORTS.map((s) => (
          <button
            key={s.key}
            onClick={() => {
              setSort(s.key);
              setShuffleSeed(0);
            }}
            className={cn(
              "rounded-md px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.2em] transition-colors",
              sort === s.key && shuffleSeed === 0
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
            )}
          >
            {s.label}
          </button>
        ))}
        <button
          onClick={() => setShuffleSeed((n) => n + 1)}
          className={cn(
            "ml-auto inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.2em] transition-colors",
            shuffleSeed > 0
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
          )}
        >
          <Shuffle className="h-3.5 w-3.5" />
          Shuffle
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {rows.map((p) => {
          const urls = cards.data?.[p.id];
          const rarity = rarities.get(p.id) ?? rarityStyle("base");
          const name = p.participant?.name ?? "—";
          const locked = isLocked(p.id);
          const tileBadge = cardBadge(
            { label: rarity.label, reason: "", accent: rarity.accent },
            locked ? "standard" : toEdition(collected[p.id]?.edition),
          );
          return (
            <Link
              key={p.id}
              to="/players/$id"
              params={{ id: p.id }}
              className="group block focus:outline-none"
            >
              {/* The link survives the lock: the detail page is gated too, and
                  it is where someone finds out what they are missing. */}
              {locked ? (
                <LockedCard
                  back={cardBack.data?.urls ?? null}
                  name={name}
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
                  // above uses — the two must never disagree.
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
                    className="text-[9px] font-bold uppercase tracking-[0.25em]"
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
                  <div className="text-[9px] font-bold uppercase tracking-[0.25em] text-muted-foreground">
                    {packedByLabel(pullCounts.data?.[p.id])}
                  </div>
                )}
              </div>
            </Link>
          );
        })}
        {rows.length === 0 && (
          <div className="col-span-full flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground">
            <Layers className="h-6 w-6 opacity-50" />
            No participants yet.
          </div>
        )}
      </div>
    </>
  );

  return (
    <div className="circuit-bg min-h-[calc(100dvh-8rem)]">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="mb-5 border-b border-primary/20 pb-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-primary">
                <Users className="h-5 w-5" />
                <span className="font-display text-xs font-bold uppercase tracking-[0.3em]">
                  Roster
                </span>
              </div>
              <h1 className="mt-1 font-display text-3xl font-black uppercase leading-none">
                The Vault
              </h1>
              {/* The collected count waits for `ready`. It used to be read straight
                  off IndexedDB, which had been inflated to the whole roster by the
                  old collect-on-sight behaviour — rendering it early would show
                  that number for a frame before it snapped down to the real one. */}
              <p className="mt-2 text-xs text-muted-foreground">
                {withCards} of {rows.length} cards printed
                {mine.ready && mine.collectedCount > 0 && ` · ${mine.collectedCount} collected`}
              </p>
              {mine.ready && packsOpenedLabel(mine.packsOpened) && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {packsOpenedLabel(mine.packsOpened)}
                </p>
              )}
              {/* Only ever rendered above zero. "0 secrets pulled" would announce
                  that a set exists at all, which is the one thing withheld — and
                  `?? 0` keeps a zero from flashing during the loading frame. */}
              {(secrets.data?.pulled ?? 0) > 0 && (
                <p className="mt-1 text-xs font-bold" style={{ color: SECRET_RARITY.accent }}>
                  {secretsPulledLabel(secrets.data!.pulled)}
                </p>
              )}
              {!member && wasMember && (
                <p className="mt-2 max-w-xs text-[11px] leading-snug text-muted-foreground">
                  Your secrets are on your name, not on this phone. Claim again to get them back.
                </p>
              )}
              {!member && (
                <Link
                  to="/claim"
                  className="mt-2 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.25em] text-primary hover:underline"
                >
                  <UserRoundCheck className="h-3.5 w-3.5" />
                  Claim your player
                </Link>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Link
                to="/awards"
                className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.25em] text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
              >
                <Award className="h-3.5 w-3.5" />
                Awards
              </Link>
              {/* Shown to everyone, including guests: the screen behind it
                  explains that trading needs a claimed player, which is a better
                  answer than a button that is not there. */}
              <Link
                to="/players/trade"
                className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.25em] text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
              >
                <ArrowLeftRight className="h-3.5 w-3.5" />
                Trade
              </Link>
              {/* The daily loop's alarm clock. Nothing else brings anyone back on
                  a random Tuesday. Leaks nothing: a guest, and a member who has
                  already pulled today, both see the button exactly as it was. */}
              <Link
                to="/players/pack"
                className={cn("neon-btn relative !px-4 !py-2 !text-xs", secretWaiting && "ring-2")}
                style={secretWaiting ? { ["--tw-ring-color" as string]: SECRET_RARITY.border } : undefined} // prettier-ignore
                aria-label={secretWaiting ? "Open today's pack — a secret is waiting" : "Open today's pack"} // prettier-ignore
              >
                <PackageOpen className="h-4 w-4" />
                Open Pack
                {secretWaiting && (
                  <span
                    aria-hidden
                    className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full"
                    style={{ background: SECRET_RARITY.border }}
                  />
                )}
              </Link>
            </div>
          </div>
        </div>

        <SecretCardSheet
          cards={visibleSecrets}
          index={openSecret}
          onIndexChange={setOpenSecret}
          onOpenChange={(open) => !open && setOpenSecret(null)}
        />

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
            <VaultSection
              key={id}
              title={section.title}
              meta={section.meta}
              accent={section.kind === "secrets" ? SECRET_RARITY.accent : undefined}
              open={!collapsed.has(id)}
              onOpenChange={() => toggle(id)}
              canMoveUp={i > 0}
              canMoveDown={i < order.length - 1}
              onMove={(delta) => move(id, delta)}
            >
              {section.kind === "roster" ? rosterBody : secretGrid(section.items)}
            </VaultSection>
          );
        })}
      </div>
    </div>
  );
}
