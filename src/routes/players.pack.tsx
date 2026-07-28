import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ArrowLeft, PackageOpen, Sparkles } from "lucide-react";
import { useEventBundle } from "@/hooks/use-event-bundle";
import { useEventCardUrls } from "@/hooks/use-photo-urls";
import { HoloCard } from "@/components/holo-card";
import { CardBackPanel } from "@/components/card-back-panel";
import { rarityMap, rarityStyle, type Rarity } from "@/lib/card-rarity";
import { collectCard, loadCollection, loadPackState, savePackState } from "@/lib/card-collection";
import { playReveal, playTear } from "@/lib/card-sfx";
import { seededRng, shuffle } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/players/pack")({
  head: () => ({
    meta: [
      { title: "Open a Pack — Will YOU Be My Hero? Draft Combine" },
      {
        name: "description",
        content: "Rip today's pack of combine trading cards. Same pack for the whole league.",
      },
      { property: "og:title", content: "Draft Combine — Open a Pack" },
      { property: "og:description", content: "Three cards. One hit. Same pack for everyone." },
    ],
  }),
  component: PackPage,
});

const PACK_SIZE = 3;
/** Drag distance, as a fraction of the pack width, that completes the tear. */
const TEAR_THRESHOLD = 0.55;

/** Local date key so the pack rolls over at midnight in the user's own timezone. */
function todayKey(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * A ragged tear edge, deterministic for a given seed so the same pack always
 * tears the same way.
 */
function tearPolygon(rng: () => number, progress: number): string {
  const steps = 14;
  const points: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const x = (i / steps) * 100;
    const jitter = (rng() - 0.5) * 9;
    points.push(`${x.toFixed(1)}% ${Math.max(0, progress * 100 + jitter).toFixed(1)}%`);
  }
  return `polygon(0% 0%, 100% 0%, ${[...points].reverse().join(", ")})`;
}

/** Generic card back shown while a pulled card is still face-down. */
function SealedBack() {
  return (
    <div className="wax-foil flex h-full w-full flex-col items-center justify-center gap-1 p-3 text-center">
      <Sparkles className="h-5 w-5 text-primary/80" />
      <div className="font-display text-[8px] font-black uppercase tracking-[0.3em] text-primary/80">
        Will YOU Be My Hero?
      </div>
      <div className="font-display text-sm font-black uppercase leading-none text-foreground/90">
        Draft Combine
      </div>
    </div>
  );
}

function PackPage() {
  const { event, bundle } = useEventBundle();
  const cards = useEventCardUrls(event?.id ?? null);
  const rarities = useMemo(() => rarityMap(bundle), [bundle]);

  const [collected, setCollected] = useState<Record<string, unknown>>({});
  const [collectionLoaded, setCollectionLoaded] = useState(false);
  // Snapshot of the collection taken when a pack is dealt. The pack composition
  // must not shift while the user is revealing it, and revealing a card writes
  // straight back into `collected`.
  const [packBaseline, setPackBaseline] = useState<Record<string, unknown> | null>(null);
  // Today's dealt cards, once the wrapper is off. Null means the pack is still
  // sealed; undefined-until-loaded is tracked by `stateLoaded` instead, so the
  // sealed pack never flashes on a day that has already been opened.
  const [dealtIds, setDealtIds] = useState<string[] | null>(null);
  const [stateLoaded, setStateLoaded] = useState(false);
  const [progress, setProgress] = useState(0);
  const [revealed, setRevealed] = useState<number[]>([]);
  const [peeking, setPeeking] = useState(false);
  const dragRef = useRef<HTMLDivElement>(null);

  const dayKey = useMemo(() => todayKey(), []);
  const seed = `${event?.id ?? "no-event"}:${dayKey}`;

  useEffect(() => {
    loadCollection().then((c) => {
      setCollected(c);
      setCollectionLoaded(true);
    });
  }, []);

  // One pack a day, so a return visit resumes rather than deals. Yesterday's row
  // is simply ignored — the next tear overwrites it.
  useEffect(() => {
    loadPackState().then((s) => {
      if (s && s.dayKey === dayKey && s.ids.length > 0) {
        setDealtIds(s.ids);
        setRevealed(s.revealed);
      }
      setStateLoaded(true);
    });
  }, [dayKey]);

  useEffect(() => {
    if (!collectionLoaded) return;
    setPackBaseline((prev) => prev ?? collected);
  }, [collectionLoaded, collected]);

  // What today's pack *would* be if torn open right now. Slots 1..n-1 come from a
  // seeded shuffle — the same for the whole league, and refreshing cannot reroll
  // it — and the last slot prefers a card the user has not collected yet, so the
  // set actually completes.
  const nextPack = useMemo(() => {
    const all = bundle?.participants ?? [];
    if (all.length === 0 || !packBaseline) return [];
    const order = shuffle(all, seededRng(seed));
    const picks = order.slice(0, Math.min(PACK_SIZE, order.length));
    const missing = order.find((p) => !packBaseline[p.id] && !picks.slice(0, -1).includes(p));
    if (missing && picks.length === PACK_SIZE) picks[PACK_SIZE - 1] = missing;
    return picks;
  }, [bundle, seed, packBaseline]);

  // Once dealt, the stored ids are the pack. Re-deriving would drift: the last
  // slot depends on what was uncollected when the pack was opened.
  const pack = useMemo(() => {
    const all = bundle?.participants ?? [];
    if (!dealtIds) return nextPack;
    return dealtIds.map((id) => all.find((p) => p.id === id)).filter((p) => p != null);
  }, [bundle, dealtIds, nextPack]);

  const torn = dealtIds != null;

  const tearOpen = useCallback(() => {
    if (dealtIds || nextPack.length === 0) return;
    const ids = nextPack.map((p) => p.id);
    setDealtIds(ids);
    playTear();
  }, [dealtIds, nextPack]);

  function onDrag(clientY: number) {
    const el = dragRef.current;
    if (!el || torn) return;
    const r = el.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (clientY - r.top) / r.height));
    setProgress(p);
    if (p >= TEAR_THRESHOLD) tearOpen();
  }

  async function revealAt(i: number) {
    if (revealed.includes(i)) return;
    const ep = pack[i];
    if (!ep) return;
    const rarity = rarities.get(ep.id) ?? rarityStyle("base");
    const isHit = i === pack.length - 1;

    // Hold on the glowing edge before the hit lands. The pause is the whole trick.
    if (isHit) {
      setPeeking(true);
      await new Promise((r) => setTimeout(r, 900));
      setPeeking(false);
    }

    setRevealed((prev) => [...prev, i]);
    playReveal(rarity.tier);
    void collectCard(ep.id, rarity.tier);
    setCollected((prev) => ({ ...prev, [ep.id]: true }));

    if (rarity.tier === "champion" || rarity.tier === "podium") {
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      if (!reduce) {
        const { default: confetti } = await import("canvas-confetti");
        confetti({
          particleCount: 90,
          spread: 75,
          origin: { y: 0.55 },
          colors: ["#38bdf8", "#22d3ee", "#a5f3fc", "#fbbf24"],
        });
      }
    }
  }

  // Written on every step rather than only on tear, so a phone that loses the tab
  // mid-reveal comes back to the cards it had already flipped.
  useEffect(() => {
    if (!dealtIds) return;
    void savePackState({ dayKey, ids: dealtIds, revealed });
  }, [dealtIds, dayKey, revealed]);

  const allRevealed = pack.length > 0 && revealed.length === pack.length;
  const collectedCount = (bundle?.participants ?? []).filter((p) => collected[p.id]).length;
  const total = bundle?.participants.length ?? 0;

  // The sealed pack must not flash on a day already opened, so nothing renders
  // until the stored state has been read.
  if (!stateLoaded) {
    return <div className="p-10 text-center text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="circuit-bg min-h-[calc(100dvh-8rem)]">
      <div className="mx-auto max-w-4xl px-4 py-6">
        <div className="mb-5 flex items-center justify-between border-b border-primary/20 pb-4">
          <Link
            to="/players"
            className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-[0.3em] text-primary hover:underline"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Vault
          </Link>
          <div className="text-right">
            <div className="font-display text-[10px] font-bold uppercase tracking-[0.3em] text-muted-foreground">
              Collected
            </div>
            <div className="font-display text-lg font-black text-primary">
              {collectedCount} / {total}
            </div>
          </div>
        </div>

        {!torn ? (
          <div className="flex flex-col items-center gap-5 py-6">
            <div className="text-center">
              <h1 className="font-display text-3xl font-black uppercase leading-none">
                Today&apos;s Pack
              </h1>
              <p className="mt-2 max-w-sm text-xs text-muted-foreground">
                One pack a day, and everyone in the league gets this exact one. Refreshing
                won&apos;t reroll it — drag down to rip it open.
              </p>
            </div>

            <div
              ref={dragRef}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                onDrag(e.clientY);
              }}
              onPointerMove={(e) => {
                if (e.buttons > 0) onDrag(e.clientY);
              }}
              onPointerUp={() => {
                if (!torn) setProgress(0);
              }}
              role="button"
              tabIndex={0}
              aria-label="Drag down to open the pack"
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  tearOpen();
                }
              }}
              className="wax-foil hud-glow relative aspect-[3/4] w-full max-w-xs cursor-grab touch-none overflow-hidden rounded-2xl border border-primary/40 active:cursor-grabbing"
            >
              <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
                <Sparkles className="h-8 w-8 text-primary" />
                <div className="font-display text-xs font-black uppercase tracking-[0.35em] text-primary/90">
                  Will YOU Be My Hero?
                </div>
                <div className="font-display text-3xl font-black uppercase leading-none">
                  Draft Combine
                </div>
                <div className="font-display text-[10px] font-bold uppercase tracking-[0.3em] text-muted-foreground">
                  {PACK_SIZE} cards · {event?.year ?? ""}
                </div>
              </div>
              {/* Torn-away portion, revealed as the drag progresses. */}
              {progress > 0 && (
                <div
                  aria-hidden
                  className="absolute inset-0 bg-background/85"
                  style={{ clipPath: tearPolygon(seededRng(seed), progress) }}
                />
              )}
            </div>

            <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted-foreground">
              Drag down · or press Enter
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="text-center">
              <h1 className="font-display text-2xl font-black uppercase leading-none">
                {allRevealed ? "Pack Complete" : "Tap to Reveal"}
              </h1>
              {peeking && (
                <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.3em] text-primary">
                  Last card…
                </p>
              )}
            </div>

            {/* Three across at every width: the whole pack is in view at once on a
                phone, which a two-column grid with an orphan third card was not. */}
            <div className="mx-auto grid max-w-2xl grid-cols-3 gap-2 sm:gap-4">
              {pack.map((ep, i) => {
                const rarity: Rarity = rarities.get(ep.id) ?? rarityStyle("base");
                const isRevealed = revealed.includes(i);
                const isHit = i === pack.length - 1;
                const name = ep.participant?.name ?? "—";
                return (
                  <motion.div
                    key={ep.id}
                    initial={{ opacity: 0, y: 24 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.07, type: "spring", stiffness: 220, damping: 20 }}
                    className="flex flex-col gap-2"
                  >
                    {/* The card owns its own button semantics — wrapping it in
                        another button would nest interactive elements. */}
                    <div
                      className={cn(
                        "rounded-xl transition-shadow",
                        peeking && isHit && "animate-pulse",
                      )}
                      style={
                        peeking && isHit
                          ? {
                              boxShadow: `inset 0 0 0 6px ${rarity.border}, 0 0 40px ${rarity.border}`,
                            }
                          : undefined
                      }
                    >
                      {isRevealed ? (
                        // Uncontrolled once revealed, so it flips freely front to back.
                        <HoloCard
                          frontUrl={cards.data?.[ep.id]?.front ?? null}
                          backUrl={cards.data?.[ep.id]?.back ?? null}
                          name={name}
                          rarity={rarity}
                          cacheKey={ep.id}
                          backContent={<CardBackPanel ep={ep} bundle={bundle} rarity={rarity} />}
                        />
                      ) : (
                        <HoloCard
                          frontUrl={cards.data?.[ep.id]?.front ?? null}
                          backUrl={null}
                          name={`Card ${i + 1}`}
                          rarity={rarityStyle("base")}
                          cacheKey={ep.id}
                          faceDown
                          flipped={false}
                          interactive={false}
                          backContent={<SealedBack />}
                          onClick={() => void revealAt(i)}
                        />
                      )}
                    </div>
                    <AnimatePresence>
                      {isRevealed && (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className="text-center"
                        >
                          <Link
                            to="/players/$id"
                            params={{ id: ep.id }}
                            className="block truncate font-display text-xs font-black uppercase tracking-wide hover:text-primary"
                          >
                            {name}
                          </Link>
                          <div
                            className="text-[9px] font-bold uppercase tracking-[0.25em]"
                            style={{ color: rarity.border }}
                          >
                            {rarity.label}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
            </div>

            <div className="flex flex-wrap justify-center gap-2 pt-2">
              {!allRevealed && (
                <button
                  onClick={async () => {
                    // Sequential so the chimes stagger instead of stacking into noise.
                    for (let i = 0; i < pack.length; i++) {
                      await revealAt(i);
                      await new Promise((r) => setTimeout(r, 260));
                    }
                  }}
                  className="rounded-full border border-white/10 px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.25em] text-muted-foreground hover:border-primary/50 hover:text-primary"
                >
                  Reveal all
                </button>
              )}
              {allRevealed && (
                <Link to="/players" className="neon-btn !px-4 !py-2 !text-xs">
                  <PackageOpen className="h-4 w-4" />
                  Back to the vault
                </Link>
              )}
            </div>

            {allRevealed && (
              <p className="text-center text-[10px] font-bold uppercase tracking-[0.3em] text-muted-foreground">
                That&apos;s today&apos;s pack — come back tomorrow
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
