import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { motion } from "motion/react";
import { Check, Flame, PackageOpen, Share2 } from "lucide-react";
import { HoloCard } from "@/components/holo-card";
import { CardBackPanel } from "@/components/card-back-panel";
import { SecretBackPanel } from "@/components/secret-back-panel";
import { SharePack, type SharePackCard } from "@/components/share-pack-graphic";
import { exportCardPng, waitForPaint } from "@/lib/share-card";
import { packedByLabel } from "@/lib/card-pulls";
import { rarityStyle, type Rarity } from "@/lib/card-rarity";
import { cardBadge, type Edition } from "@/lib/card-edition";
import type { SecretCardView } from "@/lib/secret-cards";
import type { SecretSlot } from "@/lib/pack";
import { nextMilestoneLine, type Streak } from "@/lib/streaks";
import { secretTierFloorLabel, secretTierStyle } from "@/lib/secret-rarity";
import type { StreakMilestoneStatus } from "@/lib/streaks.functions";
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
  streak,
  claimable,
  canClaim,
  claiming,
  claimError,
  onClaim,
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
  /** Null until the streak query answers, which is a missing block and not a zero. */
  streak: Streak | null;
  /** The highest rung earned and not yet cashed, or null when there is nothing to take. */
  claimable: StreakMilestoneStatus | null;
  /** Whether this actor may cash it at all. False until they have an account. */
  canClaim: boolean;
  claiming: boolean;
  /** Inline, never a toast — see the note on the failed secret slot below. */
  claimError: string | null;
  onClaim: () => void;
  onRetrySecret: () => void;
}) {
  // Rendered off-screen and rasterised on demand. Kept mounted rather than
  // conditionally rendered: html-to-image measures the node, and a node that
  // arrives in the same tick as the click has no layout yet.
  const shareRef = useRef<HTMLDivElement>(null);
  const [sharing, setSharing] = useState(false);
  const [shared, setShared] = useState(false);
  const [shareFailed, setShareFailed] = useState(false);

  // The rung above wherever they are standing. Null once all five are behind
  // them, which is the one case with nothing left to promise. The copy lives in
  // streaks.ts next to streakLine, so the sentence can be tested without
  // rendering a component that takes twenty-five props.
  const nextRung = streak ? nextMilestoneLine(streak) : null;

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
    setShareFailed(false);
    try {
      await waitForPaint(node);
      await exportCardPng(node, "draft-combine-pack.png");
      setShared(true);
      setTimeout(() => setShared(false), 2200);
    } catch {
      // Still not a toast somebody has to dismiss on a screen they are enjoying
      // — but the button simply coming back said nothing at all, least of all to
      // a screen reader. A line beside it, announced politely, is the middle.
      setShareFailed(true);
      setTimeout(() => setShareFailed(false), 6000);
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
                  {/* A special finish leads in its own metal and pushes the tier
                      to the muted line under it — see cardBadge. accent, not
                      border: base and dnf set border to a near-transparent white
                      so their bezel vanishes, which left this unreadable. */}
                  {(() => {
                    const badge = cardBadge(
                      {
                        label: rarity.label,
                        reason: "",
                        accent: rarity.accent,
                      },
                      edition,
                    );
                    return (
                      <>
                        <div
                          className="text-[9px] font-bold uppercase tracking-[0.2em] sm:text-[10px]"
                          style={{ color: badge.color }}
                        >
                          {badge.headline}
                        </div>
                      </>
                    );
                  })()}
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

      {/* Above the running total, because a reward you just earned outranks a
          number that only went up by one. Absent entirely at streak zero: a first
          pack should be a first pack, not a progress bar. */}
      {streak && streak.current > 0 && (
        <div
          className="mx-auto flex max-w-xs flex-col items-center gap-2 rounded-xl border px-4 py-3 text-center"
          style={{ borderColor: "oklch(0.82 0.19 85 / 35%)" }}
        >
          <div className="flex items-center gap-1.5">
            <Flame
              aria-hidden
              className="h-4 w-4"
              style={
                {
                  color: "oklch(0.82 0.19 85)",
                  "--flame-edge": "oklch(0.82 0.19 85 / 55%)",
                } as React.CSSProperties
              }
            />
            <span
              className="font-display text-sm font-black uppercase tracking-[0.2em]"
              style={{ color: "oklch(0.82 0.19 85)" }}
            >
              Day {streak.current}
            </span>
          </div>

          {/* What the rung about to be cashed pays. The whole point of the ladder
              is that a longer run buys a better level — a promise nobody can see
              is not a reason to keep a streak alive, and it is the answer to
              breaking one on purpose to re-farm day 3. */}
          {claimable?.tierFloor && (
            <span
              className="font-display text-[10px] font-black uppercase tracking-[0.18em]"
              style={{ color: secretTierStyle(claimable.tierFloor).accent }}
            >
              {secretTierFloorLabel(claimable.tierFloor)}
            </span>
          )}

          {claimable ? (
            canClaim ? (
              <>
                <button
                  onClick={onClaim}
                  disabled={claiming}
                  data-testid="streak-claim"
                  className="neon-btn !px-4 !py-2 !text-xs disabled:opacity-40"
                >
                  {claiming ? "Opening…" : `Claim ${claimable.label}`}
                </button>
                {/* Never a toast, for the same reason the failed secret slot
                    avoids one: it announces the reward to whoever is glancing at
                    the phone over your shoulder. */}
                {claimError && (
                  <span className="text-[10px] leading-snug text-muted-foreground">
                    {claimError}
                  </span>
                )}
              </>
            ) : (
              <>
                <Link
                  to="/auth"
                  search={{ mode: "signup", next: "/players/pack" }}
                  className="neon-btn !px-4 !py-2 !text-xs"
                >
                  Sign in to claim
                </Link>
                {/* Deliberately not "claim your player": thirteen people are on
                    the roster and everyone else is here to watch. An account is
                    something anybody can have, and it is what keeps the card. */}
                <span className="text-[10px] leading-snug text-muted-foreground">
                  {claimable.label} is waiting. An account keeps it on every phone you play from.
                </span>
              </>
            )
          ) : (
            <>
              <span className="text-[10px] leading-snug text-muted-foreground">
                {streak.openedToday
                  ? "Streak alive. Come back tomorrow."
                  : "Open today's pack to keep it alive."}
              </span>
              {/* The only place the ladder is visible BEFORE you are standing on
                  it. Without it "come back tomorrow" is a request with nothing
                  behind it. */}
              {nextRung && (
                <span className="text-[10px] leading-snug text-muted-foreground">{nextRung}</span>
              )}
            </>
          )}
        </div>
      )}

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

      {/* Polite, so it does not interrupt the reveal it sits under. */}
      <p role="status" aria-live="polite" className="mt-2 text-center text-xs text-warn">
        {shareFailed ? "Couldn't build that image — try again in a moment." : ""}
      </p>

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
