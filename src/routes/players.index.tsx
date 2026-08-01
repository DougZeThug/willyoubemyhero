import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Users, Shuffle, PackageOpen, Layers, Award, Check, UserRoundCheck } from "lucide-react";
import { useEventBundle } from "@/hooks/use-event-bundle";
import { useEventCardUrls } from "@/hooks/use-photo-urls";
import { HoloCard } from "@/components/holo-card";
import { rarityMap, rarityStyle } from "@/lib/card-rarity";
import { useMemberSession, WAS_MEMBER_KEY } from "@/lib/member-token";
import { useMySecrets, useSecretActor, useSecretStatus } from "@/hooks/use-daily-secret";
import { useCardPullCounts } from "@/hooks/use-card-pulls";
import { useMyCollection } from "@/hooks/use-my-collection";
import { packedByLabel, packsOpenedLabel } from "@/lib/card-pulls";
import { SecretCardSheet } from "@/components/secret-card-sheet";
import {
  secretFoil,
  secretsPulledLabel,
  SECRET_RARITY,
  type OwnedSecret,
} from "@/lib/secret-cards";
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

function PlayersPage() {
  const { event, bundle } = useEventBundle();
  const cards = useEventCardUrls(event?.id ?? null);
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
  const [openSecret, setOpenSecret] = useState<OwnedSecret | null>(null);
  // Set on claim and never cleared, so a member on a new phone gets told where
  // their collection went instead of watching it silently vanish. Read in an
  // effect rather than during render: SSR has no localStorage, and a mismatched
  // first paint is exactly the bug use-photo-urls.ts is written around.
  const [wasMember, setWasMember] = useState(false);
  useEffect(() => {
    setWasMember(localStorage.getItem(WAS_MEMBER_KEY) === "1");
  }, []);

  const rarities = useMemo(() => rarityMap(bundle), [bundle]);

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
      case "rarity":
        return list.sort(
          (a, b) =>
            (rarities.get(a.id)?.rank ?? 9) - (rarities.get(b.id)?.rank ?? 9) ||
            byName(a).localeCompare(byName(b)),
        );
      default:
        return list.sort((a, b) => byName(a).localeCompare(byName(b)));
    }
  }, [bundle, event?.id, sort, shuffleSeed, rarities]);

  const rosterIds = useMemo(() => rows.map((p) => p.id), [rows]);
  const mine = useMyCollection(event?.id ?? null, rosterIds);
  const collected = mine.collection;

  const withCards = rows.filter((p) => cards.data?.[p.id]?.front).length;
  const secretWaiting = !!secretStatus.data?.claimed && !secretStatus.data.pulledToday && secretStatus.data.available; // prettier-ignore
  const ownedSecrets = secrets.data?.cards ?? [];

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

          <div className="mt-4 flex flex-wrap items-center gap-1.5">
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
        </div>

        {/* Its own shelf rather than interleaved into the grid: every SortKey
            branch reads a field a secret does not have, and editorially a secret
            is not a roster card. Nothing is rendered at zero — no header, no
            slots, no silhouettes. An unpulled secret is not "missing", it is
            unknown. */}
        {ownedSecrets.length > 0 && (
          <section className="mb-6">
            <div
              className="mb-3 font-display text-[10px] font-bold uppercase tracking-[0.3em]"
              style={{ color: SECRET_RARITY.accent }}
            >
              Secrets
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {ownedSecrets.map((s) => {
                const rarity = secretFoil(s.foil);
                return (
                  <div key={s.id} className="flex flex-col gap-2">
                    <HoloCard
                      frontUrl={s.artUrl}
                      backUrl={null}
                      name={s.name}
                      rarity={rarity}
                      cacheKey={s.id}
                      intensity="subtle"
                      interactive={false}
                      onClick={() => setOpenSecret(s)}
                    />
                    <div className="text-center">
                      <div className="truncate font-display text-xs font-black uppercase tracking-wide">
                        {s.name}
                      </div>
                      <div
                        className="text-[9px] font-bold uppercase tracking-[0.25em]"
                        style={{ color: rarity.border }}
                      >
                        {/* Same vocabulary as card-slab.tsx, so the two halves of
                            the collection speak the same language. */}
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
          </section>
        )}

        <SecretCardSheet card={openSecret} onOpenChange={(open) => !open && setOpenSecret(null)} />

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {rows.map((p) => {
            const urls = cards.data?.[p.id];
            const rarity = rarities.get(p.id) ?? rarityStyle("base");
            const name = p.participant?.name ?? "—";
            return (
              <Link
                key={p.id}
                to="/players/$id"
                params={{ id: p.id }}
                className="group block focus:outline-none"
              >
                <HoloCard
                  frontUrl={urls?.front ?? null}
                  backUrl={null}
                  name={name}
                  rarity={rarity}
                  cacheKey={p.id}
                  intensity="subtle"
                  className="transition-transform group-hover:scale-[1.02]"
                />
                <div className="mt-2 text-center">
                  <div className="truncate font-display text-sm font-black uppercase tracking-wide text-foreground group-hover:text-primary">
                    {name}
                  </div>
                  {/* A tick, not a word: the tier label is the line's real
                      content, and the set only fills in a card at a time. */}
                  <div className="flex items-center justify-center gap-1">
                    {collected[p.id] && (
                      <Check className="h-3 w-3 shrink-0 text-primary" aria-label="Collected" />
                    )}
                    <span
                      className="text-[9px] font-bold uppercase tracking-[0.25em]"
                      style={{ color: rarity.tier === "base" ? undefined : rarity.border }}
                    >
                      {urls?.front ? rarity.label : "No card yet"}
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
      </div>
    </div>
  );
}
