import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { motion } from "motion/react";
import { Check, PackageOpen, Share2 } from "lucide-react";
import { HoloCard } from "@/components/holo-card";
import { CardBackPanel } from "@/components/card-back-panel";
import { SecretBackPanel } from "@/components/secret-back-panel";
import { SharePack, type SharePackCard } from "@/components/share-pack-graphic";
import { exportCardPng } from "@/lib/share-card";
import { packedByLabel } from "@/lib/card-pulls";
import { rarityStyle, type Rarity } from "@/lib/card-rarity";
import { editionLabel, editionStyle, type Edition } from "@/lib/card-edition";
import type { SecretCardView } from "@/lib/secret-cards";
import type { SecretSlot } from "@/lib/pack";
import type { CardUrls, ImageUrlSet } from "@/lib/media";
import type { StatsBundle } from "@/lib/card-stats";
import { urlFromSet } from "@/lib/media";
import { cn } from "@/lib/utils";

type SummaryParticipant = {
  id: string;
  participant_id: string;
  running_order: number;
  bib_number: number | null;
  selected_draft_position: number | null;
  participant?: { name?: string | null; trash_talk_quote?: string | null } | null;
};

/**
 * Where the pack ends up.
 *
 * The sequence used to stop rather than finish: the last card was turned and the
 * screen simply became a grid, with the fourth slot below it and a link back to
 * the vault. Everything that had been built up over the previous thirty seconds
 * was spent, and nothing collected it.
 *
 * So this is the curtain call. Every pull laid out at once — which is only
 * allowed *here*, after they have each been earned one at a time — the secret
 * larger because it is the one nobody else has, the collection counter that was
 * hidden for the whole reveal, and somewhere to go next.
 */
export function PackSummary({
  pack,
  bundle,
  cards,
  rarities,
  editions = {},
  revealed,
  pullCounts,
  universalBack,
  secretSlot,
  secret,
  secretRarity,
  secretDuplicate,
  secretPulled,
  collected,
  total,
  eventYear,
  onRetrySecret,
}: {
  pack: SummaryParticipant[];
  bundle: StatsBundle | null | undefined;
  cards: Record<string, CardUrls> | undefined;
  rarities: Map<string, Rarity>;
  /** Finishes by card id. Empty by default, so every card reads as standard. */
  editions?: Record<string, Edition>;
  revealed: number[];
  pullCounts: Record<string, number> | undefined;
  universalBack: ImageUrlSet | null;
  secretSlot: SecretSlot;
  secret: SecretCardView | null;
  secretRarity: Rarity;
  secretDuplicate: boolean;
  /** How many secrets this person has ever pulled, for the first-timer line. */
  secretPulled: number;
  collected: number;
  total: number;
  eventYear: number | null;
  onRetrySecret: () => void;
}) {
  // Rendered off-screen and rasterised on demand. Kept mounted rather than
  // conditionally rendered: html-to-image measures the node, and a node that
  // arrives in the same tick as the click has no layout yet.
  const shareRef = useRef<HTMLDivElement>(null);
  const [sharing, setSharing] = useState(false);
  const [shared, setShared] = useState(false);

  const shareCards: SharePackCard[] = [
    ...pack.map((ep) => {
      const rarity = rarities.get(ep.id) ?? rarityStyle("base");
      return {
        name: ep.participant?.name ?? "—",
        rarityLabel: rarity.label,
        rarityColor: rarity.accent,
        artUrl: cards?.[ep.id]?.front ?? null,
      };
    }),
    ...(secretSlot === "open" && secret
      ? [
          {
            name: secret.name,
            rarityLabel: "Secret",
            rarityColor: secretRarity.accent,
            artUrl: secret.artUrl,
            secret: true,
          },
        ]
      : []),
  ];

  async function share() {
    const node = shareRef.current;
    if (!node || sharing) return;
    setSharing(true);
    try {
      await exportCardPng(node, "draft-combine-pack.png");
      setShared(true);
      setTimeout(() => setShared(false), 2200);
    } catch {
      // A share that could not be produced is not worth an error somebody has to
      // dismiss on a screen they are enjoying. The button simply comes back.
    } finally {
      setSharing(false);
    }
  }

  return (
    <div className="space-y-5">
      <motion.div
        className="text-center"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h1 className="font-display text-2xl font-black uppercase leading-none">Pack Complete</h1>
        <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.3em] text-muted-foreground">
          {secretSlot === "open"
            ? "That's today's pack, secret and all"
            : "That's today's pack — come back tomorrow"}
        </p>
      </motion.div>

      {/* One row of three, deliberately small. The fourth slot below is the
          payoff and has to be reachable without a long scroll on a phone, so the
          roster trio reads as the supporting row rather than competing with it
          for height. */}
      <div className="mx-auto grid max-w-sm grid-cols-3 items-start gap-2 sm:max-w-lg sm:gap-3">
        {pack.map((ep, i) => {
          const rarity: Rarity = rarities.get(ep.id) ?? rarityStyle("base");
          const edition = editions[ep.id] ?? "standard";
          const name = ep.participant?.name ?? "—";
          return (
            <div key={ep.id} className="flex flex-col gap-1">
              {/* The card owns its own button semantics — wrapping it in another
                  button would nest interactive elements. The layout id is shared
                  with the stand, so the card flies from where it was examined
                  into its column rather than appearing there. */}
              <motion.div
                layoutId={`pack-card-${ep.id}`}
                transition={{ type: "spring", stiffness: 260, damping: 28, delay: i * 0.06 }}
                className="rounded-xl"
              >
                <HoloCard
                  frontUrl={cards?.[ep.id]?.front ?? null}
                  backUrl={cards?.[ep.id]?.back ?? null}
                  name={name}
                  rarity={rarity}
                  edition={edition}
                  backContent={
                    <CardBackPanel ep={ep} bundle={bundle} rarity={rarity} edition={edition} />
                  }
                />
              </motion.div>
              {revealed.includes(i) && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-center"
                >
                  {/* Two lines at most: at three-up the column is narrow, and the
                      grid's items-start absorbs uneven rows. */}
                  <Link
                    to="/players/$id"
                    params={{ id: ep.id }}
                    className="block line-clamp-2 font-display text-[11px] font-black uppercase leading-tight tracking-wide hover:text-primary sm:text-sm"
                  >
                    {name}
                  </Link>
                  {/* accent, not border: base and dnf set border to a
                      near-transparent white so their bezel vanishes, which left
                      this label all but unreadable. */}
                  <div
                    className="text-[9px] font-bold uppercase tracking-[0.2em] sm:text-[10px]"
                    style={{ color: rarity.accent }}
                  >
                    {rarity.label}
                  </div>
                  {/* Its own line, for the reason the stand's is: "Gold" is
                      already podium's tier label. */}
                  {editionLabel(edition) && (
                    <div
                      className="text-[9px] font-bold uppercase tracking-[0.2em] sm:text-[10px]"
                      style={{ color: editionStyle(edition).accent }}
                    >
                      {editionLabel(edition)}
                    </div>
                  )}
                  {packedByLabel(pullCounts?.[ep.id]) && (
                    <div className="text-[8px] font-bold uppercase leading-tight tracking-[0.15em] text-muted-foreground sm:text-[9px]">
                      {packedByLabel(pullCounts?.[ep.id])}
                    </div>
                  )}
                </motion.div>
              )}
            </div>
          );
        })}
      </div>

      <SecretSlotView
        slot={secretSlot}
        card={secret}
        rarity={secretRarity}
        duplicate={secretDuplicate}
        pulledCount={secretPulled}
        universalBack={universalBack}
        onRetry={onRetrySecret}
      />

      {/* The counter that was hidden for the whole reveal. A running total over a
          card whose job is to be the biggest thing on screen is a distraction;
          here it is the point. */}
      <div className="mx-auto flex max-w-xs items-center justify-between rounded-xl border border-primary/20 px-4 py-2.5">
        <span className="font-display text-[10px] font-bold uppercase tracking-[0.3em] text-muted-foreground">
          Collected
        </span>
        <span
          data-testid="collected-count"
          className="font-display text-lg font-black text-primary"
        >
          {collected} / {total}
        </span>
      </div>

      <div className="flex flex-wrap justify-center gap-2 pt-1">
        <Link to="/players" className="neon-btn !px-4 !py-2 !text-xs">
          <PackageOpen className="h-4 w-4" />
          View collection
        </Link>
        <button
          onClick={() => void share()}
          disabled={sharing || shareCards.length === 0}
          className={cn(
            "inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground",
            "hover:border-primary/50 hover:text-primary disabled:opacity-40",
          )}
        >
          {shared ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
          {sharing ? "Rendering…" : shared ? "Shared" : "Share pack"}
        </button>
      </div>

      {/* Off-screen, and kept in the tree so it has layout when the button is
          pressed. `left` rather than `display: none` — html-to-image cannot
          rasterise a node the browser has not laid out. */}
      <div aria-hidden className="pointer-events-none fixed -left-[9999px] top-0">
        <SharePack ref={shareRef} data={{ eventYear, cards: shareCards, collected, total }} />
      </div>
    </div>
  );
}

/**
 * The fourth slot, as it appears in the finished pack.
 *
 * The ceremony itself belongs to PackStand — by the time this renders, the card
 * has already been turned over. What is left here is the card at rest, plus the
 * two states that never reach the stand at all: a guest who has not claimed, and
 * a pull that could not complete.
 */
function SecretSlotView({
  slot,
  card,
  rarity,
  duplicate,
  pulledCount,
  universalBack,
  onRetry,
}: {
  slot: SecretSlot;
  card: SecretCardView | null;
  rarity: Rarity;
  duplicate: boolean;
  pulledCount: number;
  universalBack: ImageUrlSet | null;
  onRetry: () => void;
}) {
  if (slot === "hidden") return null;

  return (
    // Wider than a board card. The fourth slot has to stay visibly the biggest
    // thing here or it stops reading as the thing nobody else on the roster has.
    <div className="mx-auto flex w-full max-w-[240px] flex-col items-center gap-2 pt-2">
      <div className="text-center">
        <h2
          className="font-display text-sm font-black uppercase tracking-[0.2em]"
          style={{ color: rarity.accent }}
        >
          One More Card
        </h2>
      </div>

      {slot === "failed" ? (
        <button
          onClick={onRetry}
          className="wax-foil flex aspect-[5/7] w-full flex-col items-center justify-center gap-2 rounded-xl border border-white/15 p-4 text-center opacity-60"
        >
          <span className="font-display text-xs font-black uppercase tracking-[0.2em]">
            No signal
          </span>
          {/* Never a toast: a toast announces a fourth card to whoever is
              glancing at the phone over your shoulder. */}
          <span className="text-[10px] leading-snug text-muted-foreground">
            Tap to try again — you haven&apos;t used today&apos;s.
          </span>
        </button>
      ) : slot === "pending" ? (
        <div className="wax-foil flex aspect-[5/7] w-full animate-pulse items-center justify-center rounded-xl border border-white/15" />
      ) : card ? (
        <>
          {/* w-full is load-bearing: the column above centres its items, which
              makes a flex child shrink to its content, and HoloCard sizes itself
              from its width via aspect-ratio — so without this the card collapses
              to nothing and the slot renders as a sliver. */}
          <motion.div
            layoutId="pack-card-secret"
            transition={{ type: "spring", stiffness: 260, damping: 28 }}
            className={cn("relative w-full rounded-xl", duplicate && "secret-dupe-shimmer")}
          >
            <HoloCard
              frontUrl={card.artUrl}
              backUrl={universalBack}
              name={card.name}
              rarity={rarity}
              tilt="hero"
              backContent={<SecretBackPanel card={card} rarity={rarity} />}
            />
          </motion.div>
          <div className="text-center">
            <div className="truncate font-display text-xs font-black uppercase tracking-wide">
              {card.name}
            </div>
            {duplicate ? (
              <div className="text-[9px] font-bold uppercase tracking-[0.25em] text-muted-foreground">
                Already yours — you&apos;ve pulled the whole set. This one&apos;s just showing off.
              </div>
            ) : (
              <div
                className="text-[9px] font-bold uppercase tracking-[0.25em]"
                style={{ color: rarity.border }}
              >
                {/* Taught once, on the first secret anyone ever pulls. Without it
                    the empty vault shelf afterwards reads as a bug. */}
                {pulledCount <= 1
                  ? "Secret · Not on the roster. Nobody knows how many there are."
                  : "Secret · Yours for good, even on a new phone."}
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
