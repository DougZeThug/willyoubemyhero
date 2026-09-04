import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { motion } from "motion/react";
import { Check, Flame, PackageOpen, Share2 } from "lucide-react";
import { HoloCard } from "@/components/holo-card";
import { CardBackPanel } from "@/components/card-back-panel";
import { SecretBackPanel } from "@/components/secret-back-panel";
import { SharePack, type SharePackCard } from "@/components/share-pack-graphic";
import { LevelPips } from "@/components/level-pips";
import { PullRibbon } from "@/components/pull-ribbon";
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
  secretSellValue,
  secretPulled,
  copies,
  secretCopies,
  sellValues,
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
  /**
   * What the secret's spare copy would fetch, or null for nothing to say.
   *
   * The stand has carried this line since the dupe economy landed; the summary
   * never did, so the offer vanished the moment the sequence ended. Same value,
   * same gating — the route decides, this only prints.
   */
  secretSellValue?: number | null;
  /** How many secrets this person has ever pulled, for the first-timer line. */
  secretPulled: number;
  /**
   * Copies held of each roster card, by event_participant id, this pull counted.
   *
   * From the route's pre-pack snapshot, not the live collection — see the note on
   * `rosterCopies` there. Optional, and a card missing from it gets no ribbon
   * rather than a guessed one.
   */
  copies?: Record<string, number>;
  /** The same number for the secret, whose count lives on the server. */
  secretCopies?: number;
  /** What each spare roster copy is worth. Duplicates only, and only while dust is on. */
  sellValues?: Record<string, number>;
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
        <p className="mt-1 text-meta font-semibold text-muted-foreground">
          {secretSlot === "open"
            ? "That's today's pack, secret and all"
            : "That's today's pack — come back tomorrow"}
        </p>
      </motion.div>

      {/* The fourth card first, and full width.

          It was under the roster trio, which put the one card nobody else has
          below three cards several people do. Order is the loudest thing a
          summary says. */}
      <SecretSlotView
        slot={secretSlot}
        card={secret}
        rarity={secretRarity}
        duplicate={secretDuplicate}
        sellValue={secretSellValue ?? null}
        copies={secretCopies}
        pulledCount={secretPulled}
        universalBack={universalBack}
        onRetry={onRetrySecret}
      />

      {/* The three, in a row you scroll rather than a grid you squint at.

          They used to be a three-column grid inside a max-w-sm: 80px wide at 320
          and 100 at 390, against the 315 the same card had on the stand a second
          earlier. The pack got *smaller* at the payoff, which is backwards. A
          snap row holds every card at a readable size and spends horizontal
          space — which a phone has more of than it has vertical — instead of
          shrinking to fit three across a width that cannot take three.

          Bled to the screen edges so a card can scroll flush to it; a snap row
          that stops 16px short reads as a clipped grid. */}
      <div
        className="-mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-1"
        // The row is the scroller, so it owns the scrollbar rather than the page.
        style={{ scrollbarWidth: "none" }}
      >
        {pack.map((ep, i) => {
          const rarity: Rarity = rarities.get(ep.id) ?? rarityStyle("base");
          const edition = editions[ep.id] ?? "standard";
          const name = ep.participant?.name ?? "—";
          const held = copies?.[ep.id];
          return (
            <div
              key={ep.id}
              // The floor the audit asked for, and the one the e2e suite
              // measures. `min-width` rather than `shrink-0` carries it, and the
              // difference matters: min-width beats flex-shrink outright, so the
              // row overflows and scrolls at 390 rather than squeezing three
              // cards into a width that cannot hold them. `flex-1` on top so a
              // desktop still fills its row instead of leaving three narrow
              // cards adrift in it.
              data-testid="summary-card"
              className="flex min-w-[140px] flex-1 snap-start flex-col gap-1"
            >
              {/* The card owns its own button semantics — wrapping it in another
                  button would nest interactive elements. The layout id is shared
                  with the stand, so the card flies from where it was examined
                  into its column rather than appearing there. */}
              <motion.div
                layoutId={`pack-card-${ep.id}`}
                transition={{ type: "spring", stiffness: 260, damping: 28, delay: i * 0.06 }}
                className="relative rounded-xl"
              >
                <HoloCard
                  frontUrl={cards?.[ep.id]?.front ?? null}
                  backUrl={cards?.[ep.id]?.back ?? null}
                  name={name}
                  rarity={rarity}
                  edition={edition}
                  // The row scrolls sideways now, and drag-tilt cannot share that
                  // axis with it. A tilting card sets `touch-action: pan-y`, which
                  // hands the browser the vertical pan and keeps the horizontal
                  // one for itself — so a thumb dragging across a card tilted it
                  // and the row underneath never moved. touch-action is read once
                  // at gesture start and is final, so there is no arrangement
                  // where both work. Scrolling wins: these are thumbnails in a
                  // scrolling row, which is the case this prop exists for.
                  touchTilt={false}
                  backContent={
                    <CardBackPanel ep={ep} bundle={bundle} rarity={rarity} edition={edition} />
                  }
                />
                {/* Only once it has been turned. An unturned column is a card
                    still in the sequence, and its ribbon would answer early. */}
                {revealed.includes(i) && held != null && <PullRibbon copies={held} />}
              </motion.div>
              {revealed.includes(i) && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-center"
                >
                  {/* Two lines at most. The column is 140px now rather than 80,
                      which is what lets these read at 12px instead of 8. */}
                  <Link
                    to="/players/$id"
                    params={{ id: ep.id }}
                    className="block line-clamp-2 font-display text-sm font-black uppercase leading-tight tracking-wide hover:text-primary"
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
                      <div
                        className="text-label font-bold uppercase tracking-[0.08em]"
                        style={{ color: badge.color }}
                      >
                        {badge.headline}
                      </div>
                    );
                  })()}
                  {packedByLabel(pullCounts?.[ep.id]) && (
                    <div className="text-meta font-semibold leading-tight text-muted-foreground">
                      {packedByLabel(pullCounts?.[ep.id])}
                    </div>
                  )}
                  {/* The same offer the stand makes on a spare, in the same
                      words. It used to end with the sequence. */}
                  {sellValues?.[ep.id] ? (
                    <div className="text-label font-black uppercase tracking-[0.08em] text-primary">
                      Sell for {sellValues[ep.id]}
                    </div>
                  ) : null}
                </motion.div>
              )}
            </div>
          );
        })}
      </div>

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
              className="font-display text-badge font-black uppercase tracking-[0.08em]"
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
                  className="neon-btn-sm disabled:opacity-40"
                >
                  {claiming ? "Opening…" : `Claim ${claimable.label}`}
                </button>
                {/* Never a toast, for the same reason the failed secret slot
                    avoids one: it announces the reward to whoever is glancing at
                    the phone over your shoulder. */}
                {claimError && (
                  <span className="text-meta leading-snug text-muted-foreground">{claimError}</span>
                )}
              </>
            ) : (
              <>
                <Link
                  to="/auth"
                  search={{ mode: "signup", next: "/players/pack" }}
                  className="neon-btn-sm"
                >
                  Sign in to claim
                </Link>
                {/* Deliberately not "claim your player": thirteen people are on
                    the roster and everyone else is here to watch. An account is
                    something anybody can have, and it is what keeps the card. */}
                <span className="text-meta leading-snug text-muted-foreground">
                  {claimable.label} is waiting. An account keeps it on every phone you play from.
                </span>
              </>
            )
          ) : (
            <>
              <span className="text-meta leading-snug text-muted-foreground">
                {streak.openedToday
                  ? "Streak alive. Come back tomorrow."
                  : "Open today's pack to keep it alive."}
              </span>
              {/* The only place the ladder is visible BEFORE you are standing on
                  it. Without it "come back tomorrow" is a request with nothing
                  behind it. */}
              {nextRung && (
                <span className="text-meta leading-snug text-muted-foreground">{nextRung}</span>
              )}
            </>
          )}
        </div>
      )}

      {/* The counter that was hidden for the whole reveal. A running total over a
          card whose job is to be the biggest thing on screen is a distraction;
          here it is the point. */}
      <div className="mx-auto flex max-w-xs items-center justify-between rounded-xl border border-primary/20 px-4 py-2.5">
        <span className="font-display text-label font-bold uppercase tracking-[0.08em] text-muted-foreground">
          Collected
        </span>
        <span
          data-testid="collected-count"
          className="font-display text-lg font-black text-primary"
        >
          {collected} / {total}
        </span>
      </div>

      {/* The two ways out, both at 56px.

          Share used to be a bordered ghost beside a small primary, which is the
          hierarchy backwards: sharing the pack is the thing the group actually
          does with it. Both are first-class now.

          Stacked rather than side by side, and that is a width decision rather
          than a taste one: two 56px pills with 1.75rem of padding each do not
          fit across 320px without one of them truncating its own label. */}
      <div className="mx-auto flex max-w-xs flex-col gap-2 pt-1">
        <Link to="/players" className="neon-btn-lg w-full">
          <PackageOpen className="h-4 w-4" />
          View collection
        </Link>
        <button
          onClick={() => void share()}
          disabled={sharing || shareCards.length === 0}
          className="neon-btn-lg w-full disabled:opacity-40"
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
  sellValue,
  copies,
  pulledCount,
  universalBack,
  onRetry,
}: {
  slot: SecretSlot;
  card: SecretCardView | null;
  rarity: Rarity;
  duplicate: boolean;
  sellValue: number | null;
  copies: number | undefined;
  pulledCount: number;
  universalBack: ImageUrlSet | null;
  onRetry: () => void;
}) {
  if (slot === "hidden") return null;

  return (
    // The stand's cap, 320px, so the card is the same size at rest as it was at
    // the moment it turned rather than shrinking by a third on the handover.
    //
    // What is deliberately NOT carried over is the stand's viewport-height clamp
    // (`min(320px, calc((100svh-19rem)*5/7))`). That exists because the stand has
    // to fit the card, its name and the step dots on one screen with nothing
    // scrolling. This page scrolls, so the clamp would only ever make the card
    // smaller for no reason on a short phone.
    <div className="mx-auto flex w-full max-w-[320px] flex-col items-center gap-2 pt-2">
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
          <span className="font-display text-badge font-black uppercase tracking-[0.08em]">
            No signal
          </span>
          {/* Never a toast: a toast announces a fourth card to whoever is
              glancing at the phone over your shoulder. */}
          <span className="text-meta leading-snug text-muted-foreground">
            Tap to try again — you haven&apos;t used today&apos;s.
          </span>
        </button>
      ) : slot === "pending" ? (
        // The same sealed-back sweep the stand shows, for the window where the
        // sequence has ended and the pull is still in the air.
        <div className="wax-foil pack-seal-wait relative flex aspect-[5/7] w-full items-center justify-center overflow-hidden rounded-xl border border-white/15" />
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
            {/* The secret's count is the only one on this screen the baseline
                cannot answer — it comes from the pull's own duplicate flag. */}
            {copies != null && <PullRibbon copies={copies} />}
          </motion.div>
          <div className="text-center">
            <div className="truncate font-display text-xs font-black uppercase tracking-wide">
              {card.name}
            </div>
            {/* The only level cue this slot has ever carried, which is also why
                it is the one place the pips name the level as well as count it:
                the line below is the teaching copy about what a secret *is* and
                never says "Mythic". Everywhere else a level word sits beside
                them and naming it here too would say it twice. */}
            <LevelPips tier={card.tier} namesLevel className="mt-0.5" />
            {duplicate ? (
              <>
                <div className="text-meta font-semibold text-muted-foreground">
                  Already yours — you&apos;ve pulled the whole set. This one&apos;s just showing
                  off.
                </div>
                {/* Carried over from the stand, which was the only place it ever
                    appeared — so the answer to "what do I do with a spare"
                    disappeared at exactly the screen that has the shop link. */}
                {sellValue ? (
                  <div className="text-label font-black uppercase tracking-[0.08em] text-primary">
                    Sell for {sellValue}
                  </div>
                ) : null}
              </>
            ) : (
              <div
                className="text-badge font-bold uppercase tracking-[0.08em]"
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
