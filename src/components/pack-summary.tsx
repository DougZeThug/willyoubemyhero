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
import { cardBadge } from "@/lib/card-edition";
import { upgradeLabel } from "@/lib/pack-outcome";
import { nextMilestoneLine, type Streak } from "@/lib/streaks";
import { secretTierCaption, secretTierFloorLabel, secretTierStyle } from "@/lib/secret-rarity";
import type { StandSlot } from "@/components/pack-stand";
import type { StreakMilestoneStatus } from "@/lib/streaks.functions";
import type { CardUrls, ImageUrlSet } from "@/lib/media";
import type { StatsBundle } from "@/lib/card-stats";
import { urlFromSet } from "@/lib/media";
import { offlineReason, useIsOnline } from "@/hooks/use-online";
import { cn } from "@/lib/utils";

/**
 * The box a pulled card's name sits in, link or not.
 *
 * `min-h-11 pointer-fine:min-h-0` for the reason ui/button.tsx:28 already
 * argues: 44px is a touch guideline and a width breakpoint releases it on a
 * landscape phone, where the thumb is still the pointer.
 */
const NAME_BOX =
  "flex min-h-11 items-center justify-center font-display text-sm font-black uppercase leading-tight tracking-wide pointer-fine:min-h-0";

/**
 * Where the pack ends up.
 *
 * The sequence used to stop rather than finish: the last card was turned and the
 * screen simply became a grid with a link back to the vault. Everything that had
 * been built up over the previous thirty seconds was spent, and nothing
 * collected it.
 *
 * So this is the curtain call. Every pull laid out at once — which is only
 * allowed *here*, after they have each been earned one at a time — in the order
 * they were dealt, a secret sitting in its slot among the roster with the prism
 * ring that marks it out, the collection counter that was hidden for the whole
 * reveal, and somewhere to go next.
 */
export function PackSummary({
  slots,
  bundle,
  cards,
  revealed,
  pullCounts,
  universalBack,
  collected,
  total,
  eventYear,
  streak,
  claimable,
  canClaim,
  claiming,
  claimError,
  onClaim,
}: {
  /**
   * The pack as the stand showed it, slot by slot. Every number on a slot —
   * the count, the price, the outcome — was the route's decision before the
   * first card turned, so the summary prints exactly what the stand printed.
   */
  slots: StandSlot[];
  bundle: StatsBundle | null | undefined;
  cards: Record<string, CardUrls> | undefined;
  revealed: number[];
  pullCounts: Record<string, number> | undefined;
  universalBack: ImageUrlSet | null;
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
}) {
  // The claim mints a card on the server, so it cannot be taken in a dead spot.
  // Read here rather than passed in: the button is the only thing on this screen
  // that reaches out, and the route above it has nothing else to do with the
  // answer.
  const offline = !useIsOnline();

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

  // In dealt order, exactly as the row below. A secret is marked so the graphic
  // can frame it, and names nothing about which secret it is beyond the name
  // the person has already seen.
  const shareCards: SharePackCard[] = slots.map(({ slot, rarity, ep }) =>
    slot.kind === "secret"
      ? {
          name: slot.card.name,
          rarityLabel: "Secret",
          rarityColor: rarity.accent,
          artUrl: slot.card.artUrl,
          secret: true,
        }
      : {
          name: ep?.participant?.name ?? "—",
          rarityLabel: rarity.label,
          rarityColor: rarity.accent,
          artUrl: cards?.[slot.id]?.front ?? null,
        },
  );

  const secretRevealed = slots.some((s, i) => s.slot.kind === "secret" && revealed.includes(i));

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
          {secretRevealed
            ? "That's today's pack, secret and all"
            : "That's today's pack — come back tomorrow"}
        </p>
      </motion.div>

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
        {slots.map(({ slot, rarity, edition, outcome, copies, sellValue, ep }, i) => {
          const isSecret = slot.kind === "secret";
          const name = isSecret ? slot.card.name : (ep?.participant?.name ?? "—");
          const turned = revealed.includes(i);
          const climbed = outcome === "upgrade" ? upgradeLabel(slot) : null;
          return (
            <div
              key={slot.id}
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
                layoutId={`pack-card-${slot.id}`}
                transition={{ type: "spring", stiffness: 260, damping: 28, delay: i * 0.06 }}
                className={cn(
                  "relative rounded-xl",
                  isSecret && turned && outcome === "duplicate" && "secret-dupe-shimmer",
                )}
              >
                {isSecret ? (
                  <HoloCard
                    frontUrl={slot.card.artUrl}
                    backUrl={universalBack}
                    name={name}
                    rarity={rarity}
                    touchTilt={false}
                    backContent={<SecretBackPanel card={slot.card} rarity={rarity} />}
                  />
                ) : (
                  <HoloCard
                    frontUrl={cards?.[slot.id]?.front ?? null}
                    backUrl={cards?.[slot.id]?.back ?? null}
                    name={name}
                    rarity={rarity}
                    edition={edition ?? "standard"}
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
                      ep ? (
                        <CardBackPanel
                          ep={ep}
                          bundle={bundle}
                          rarity={rarity}
                          edition={edition ?? "standard"}
                        />
                      ) : null
                    }
                  />
                )}
                {/* Only once it has been turned. An unturned column is a card
                    still in the sequence, and its ribbon would answer early. */}
                {turned && copies != null && <PullRibbon copies={copies} upgrade={climbed} />}
              </motion.div>
              {turned && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-center"
                >
                  {/* Two lines at most. The column is 140px now rather than 80,
                      which is what lets these read at 12px instead of 8.

                      The roster name is the column's only link — the card above
                      it is a flip button, not a second route to the same place —
                      so the touch floor goes on the link itself rather than over
                      the card, which would stack a link on a button that does
                      something else. It measured 140x18 (§23 F6). The secret's
                      name is not a link and takes the same box anyway, so the
                      captions under the three columns stay level. The clamp
                      moves to the span: line-clamp is display:-webkit-box and
                      cannot share an element with the flex that centres it. */}
                  {isSecret ? (
                    <div className={NAME_BOX}>
                      <span className="line-clamp-2">{name}</span>
                    </div>
                  ) : (
                    <Link
                      to="/players/$id"
                      params={{ id: slot.id }}
                      className={cn(NAME_BOX, "hover:text-primary")}
                    >
                      <span className="line-clamp-2">{name}</span>
                    </Link>
                  )}
                  {isSecret ? (
                    <>
                      {/* The pips name the level only when the caption does not —
                          the same rule the stand follows. */}
                      <LevelPips
                        tier={slot.card.tier}
                        namesLevel={outcome === "duplicate"}
                        className="mt-0.5"
                      />
                      {outcome === "duplicate" ? (
                        <div className="text-meta font-semibold leading-tight text-muted-foreground">
                          Already yours — this one&apos;s just showing off
                        </div>
                      ) : (
                        <div
                          className="text-label font-bold uppercase tracking-[0.08em]"
                          style={{ color: secretTierStyle(slot.card.tier).accent }}
                        >
                          {secretTierCaption(slot.card.tier)}
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      {/* A special finish leads in its own metal and pushes the
                          tier to the muted line under it — see cardBadge. accent,
                          not border: base and dnf set border to a near-transparent
                          white so their bezel vanishes, which left this
                          unreadable. */}
                      {(() => {
                        const badge = cardBadge(
                          { label: rarity.label, reason: "", accent: rarity.accent },
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
                      {packedByLabel(pullCounts?.[slot.id]) && (
                        <div className="text-meta font-semibold leading-tight text-muted-foreground">
                          {packedByLabel(pullCounts?.[slot.id])}
                        </div>
                      )}
                    </>
                  )}
                  {/* The same offer the stand makes on a spare, in the same
                      words, for either kind of card. It used to end with the
                      sequence. */}
                  {sellValue ? (
                    <div className="text-label font-black uppercase tracking-[0.08em] text-primary">
                      Sell for {sellValue}
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
              className="font-display text-sm font-black uppercase tracking-[0.08em]"
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
                  disabled={claiming || offline}
                  {...offlineReason(offline)}
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
        <Link to="/players" className="neon-btn-lg neon-btn-hero w-full">
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
