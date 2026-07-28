import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Users, Shuffle, PackageOpen, Layers, Award, Check, UserRoundCheck } from "lucide-react";
import { useEventBundle } from "@/hooks/use-event-bundle";
import { useEventCardUrls } from "@/hooks/use-photo-urls";
import { HoloCard } from "@/components/holo-card";
import { rarityMap, rarityStyle } from "@/lib/card-rarity";
import { loadCollection, type CollectedCard } from "@/lib/card-collection";
import { useMemberSession } from "@/lib/member-token";
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
  // Typed rather than `unknown`: `{collected[p.id] && <Check/>}` renders the
  // left operand when it is falsy, and an `unknown` there is not a ReactNode.
  const [collected, setCollected] = useState<Record<string, CollectedCard>>({});
  const member = useMemberSession();

  useEffect(() => {
    loadCollection().then(setCollected);
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

  const withCards = rows.filter((p) => cards.data?.[p.id]?.front).length;
  const collectedCount = rows.filter((p) => collected[p.id]).length;

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
              <p className="mt-2 text-xs text-muted-foreground">
                {withCards} of {rows.length} cards printed
                {collectedCount > 0 && ` · ${collectedCount} collected`}
              </p>
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
              <Link
                to="/players/pack"
                className="neon-btn !px-4 !py-2 !text-xs"
                aria-label="Open today's pack"
              >
                <PackageOpen className="h-4 w-4" />
                Open Pack
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
