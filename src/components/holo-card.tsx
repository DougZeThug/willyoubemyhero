import { memo, useId, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { initialsOf } from "@/lib/format";
import { playFlip } from "@/lib/card-sfx";
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";
import { CARD_GRID_SIZES, CARD_SIZES } from "@/lib/media";
import { FLIP_MS } from "@/lib/stand-view";
import { useCardTilt, type TiltVariant } from "@/components/use-card-tilt";
import { useSteppedImage } from "@/components/use-stepped-image";
import type { ImageUrlSet } from "@/lib/media";
import type { Rarity } from "@/lib/card-rarity";
import { BORDER_FX_CLASS } from "@/lib/card-rarity";
import { EDITION_ANIM_CLASS, EDITION_CLASS, editionLabel, editionStyle } from "@/lib/card-edition";
import type { Edition } from "@/lib/card-edition";

/**
 * Standard trading card is 2.5in x 3.5in, and every card in the app is that
 * shape — full stop. The frame used to take its ratio from whatever the art
 * happened to be exported at, which left the vault grid with tiles of subtly
 * different heights. Off-ratio art is cropped to the frame by `object-cover`.
 */
const CARD_ASPECT = 5 / 7;

/**
 * How the card turns over.
 *
 * Slow to leave, quick through edge-on, and it settles past its mark before
 * coming back — about 3.4° of overshoot at the end. A card that arrives exactly
 * on 180° and stops reads as a value being interpolated; one that goes slightly
 * too far and rocks back reads as an object with mass.
 */
export const FLIP_CURVE = "cubic-bezier(0.5, 0, 0.25, 1.18)";

/**
 * Where in the flip the card is edge-on, as a fraction of its duration.
 *
 * Not 0.5, and this is the single most breakable thing about `FLIP_CURVE`.
 * `.holo-face` swaps which side is visible at this moment — it has to, because
 * WebKit shows the away face mirrored through the card inside this nested
 * preserve-3d structure — and an accelerating curve reaches 90° well before the
 * halfway point. Left at 0.5, the swap happens with the card already a third of
 * the way round and the wrong face is briefly visible, reversed.
 *
 * Solved from the curve rather than eyeballed: the value below is where the
 * bezier's output first reaches 0.5, which is 90° of a 180° turn. Change the
 * curve and this must be re-solved with it.
 */
export const FLIP_EDGE_AT = 0.384;

/**
 * Play a CSS animation again on an element that is already wearing it.
 *
 * Removing the animation, forcing the browser to read a layout value, then
 * putting it back is the only reliable way: the style recalculation between the
 * two writes is what makes the browser notice the animation went away, and
 * without the read it coalesces both writes into no change at all.
 */
function restartAnimation(el: HTMLElement | null) {
  if (!el) return;
  el.style.animation = "none";
  void el.offsetHeight;
  el.style.animation = "";
}

export type { TiltVariant };

/**
 * The ways a card answers to a hand, beyond tilting under it. Each is a default
 * that exactly one kind of caller turns off or on, so they travel together and
 * a plain card names none of them. Pass a module-level constant: HoloCard is
 * memoised, and a fresh object per render would defeat it.
 */
export type HoloGestures = {
  /**
   * Whether a finger drag tilts the card. Defaults on for full-size cards and off
   * for grid thumbnails, where claiming the gesture would fight the page scroll.
   */
  touchTilt?: boolean;
  /**
   * Whether a fast horizontal throw turns the card over. Off where the same
   * gesture means "next card" — the two full-size surfaces flip on tap instead.
   */
  flickToFlip?: boolean;
  /**
   * This card sits on a page that scrolls, so the vertical axis stays the
   * browser's. Only matters for `tilt="hero"`, which otherwise claims both axes
   * and traps the scroll across most of a phone screen.
   */
  pageScroll?: boolean;
  /** Device-orientation tilt, enabled by the caller after a permission grant. */
  gyro?: boolean;
  /**
   * On screen, but not taking a tap right now.
   *
   * Not the same as handing it no `onClick`: a card without one falls through to
   * its own flip in `handleClick`, so "no handler" turns the tap into a flip
   * rather than refusing it. This refuses it, and says so — `aria-disabled` and
   * no pointer cursor — because a control that looks pressable and does nothing
   * is worse than one that looks unavailable.
   */
  tapDisabled?: boolean;
};

/** The horizontal throw means "next card" on the surface, so the card must not also answer to it. */
export const NO_FLICK: HoloGestures = { flickToFlip: false };

export type HoloCardProps = {
  frontUrl: ImageUrlSet | string | null;
  backUrl: ImageUrlSet | string | null;
  name: string;
  rarity: Rarity;
  /**
   * The finish on this copy. Its own prop rather than a field on `rarity`
   * because the two are different kinds of fact — a tier is earned and is the
   * same on every phone, a finish is rolled and belongs to one person's copy —
   * and because a card nobody has pulled has a tier but no finish at all.
   *
   * Defaults to "standard", which renders no frame.
   */
  edition?: Edition;
  /** Controlled flip state. Omit for an uncontrolled card. */
  flipped?: boolean;
  onFlippedChange?: (next: boolean) => void;
  /** Whether the card responds to pointer tilt. */
  interactive?: boolean;
  /** See `HoloGestures`. */
  gestures?: HoloGestures;
  /**
   * How loud the foil is. "subtle" halves it for small, mostly-non-interactive
   * cards like the vault grid, where a full-strength overlay swamps the artwork.
   */
  intensity?: "full" | "subtle";
  /**
   * How dramatic the 3D tilt is. "hero" is for the one full-size card a page is
   * built around: half again the lean, a camera at 1.7x the card's width instead
   * of 3.1x, a lift toward the viewer, and it claims the *entire* touch gesture —
   * the page will not scroll while a finger is on it.
   *
   * Deliberately its own prop rather than derived from `intensity`: the pack page
   * renders full-intensity cards two-up inside a scrolling grid, where claiming
   * the gesture would trap the scroll across half the screen.
   */
  tilt?: TiltVariant;
  /** Start face-down (shows the back) regardless of art availability. */
  faceDown?: boolean;
  /**
   * How long the turn takes. The default suits a card you flip to read the back
   * of; the pack's secret slows it right down, because that flip is the payoff
   * rather than a way of getting at the stats.
   */
  flipMs?: number;
  /**
   * When the landing shine sweeps, measured from the start of the turn.
   *
   * Defaults to 82% of the flip, which is the frame the face is front-on and a
   * specular pass is a pass across a card you can actually see. The pack's stand
   * holds a special pull dim for a beat after it lands and moves the sweep to the
   * moment it blooms, so the light arrives *with* the metal rather than a
   * quarter-second before it — there, the sweep is the light coming back up.
   */
  shineDelayMs?: number;
  /** Rendered on the back face when there is no uploaded back artwork. */
  backContent?: React.ReactNode;
  className?: string;
  onClick?: () => void;
};

function HoloCardImpl({
  frontUrl,
  backUrl,
  name,
  rarity,
  edition = "standard",
  flipped,
  onFlippedChange,
  interactive = true,
  gestures,
  intensity = "full",
  tilt = "calm",
  faceDown = false,
  flipMs = FLIP_MS,
  shineDelayMs,
  backContent,
  className,
  onClick,
}: HoloCardProps) {
  const reduced = usePrefersReducedMotion();
  const titleId = useId();

  const {
    touchTilt,
    flickToFlip = true,
    pageScroll = false,
    gyro = false,
    tapDisabled = false,
  } = gestures ?? {};
  // The grid is the one place many cards mount at once, and it is the one place
  // the art is small enough that off-screen work is pure waste.
  const eager = intensity === "full";

  const imgSizes = eager ? CARD_SIZES : CARD_GRID_SIZES;
  const front = useSteppedImage(frontUrl, eager);
  const back = useSteppedImage(backUrl, eager);
  const frontSrc = front.src;
  const frontSrcSet = front.srcSet;
  const frontFailed = front.failed;
  const backSrc = back.src;
  const backSrcSet = back.srcSet;
  const backFailed = back.failed;

  const [uncontrolledFlip, setUncontrolledFlip] = useState(false);
  const isFlipped = flipped ?? uncontrolledFlip;
  const showBack = faceDown ? !isFlipped : isFlipped;
  // A generated back is just as flippable as uploaded back artwork.
  const canFlip = !!backUrl || !!backContent;

  const { sceneRef, tiltRef, cardRef, engaged, takeFlick, touchAction, handlers } = useCardTilt({
    variant: tilt,
    interactive,
    reduced,
    // A full-size card is meant to be handled; a thumbnail in a scrolling grid is not.
    touchTilt: touchTilt ?? intensity === "full",
    pageScroll,
    gyro,
    flick: canFlip && flickToFlip,
    // A caller that owns the tap owns the throw too. On the pack's reveal
    // stand, throwing the card over *is* the reveal — it has to run the
    // ceremony rather than silently turn the card behind its back.
    onFlick: () => (onClick ? onClick() : toggleFlip()),
  });

  /**
   * This card has turned over at least once, so its light, punch and shine are
   * armed.
   *
   * Driven off which face is showing rather than off the click, because the stand
   * turns its card by changing a prop and never touches this component's own
   * handlers — a flag set in `toggleFlip` would light up a tap in the vault and
   * stay dark for every card in the pack.
   *
   * A latch rather than a per-turn flag, and never a `key`. Keying the card would
   * remount it, which destroys the very thing being decorated: the flip is a
   * `transition` from the previous `rotateY`, and a fresh element has no previous
   * value to transition from — it would simply appear already turned. So the
   * elements persist and the animations are restarted by hand below.
   */
  const [armed, setArmed] = useState(false);
  const firstFaceRef = useRef(true);
  const armedRef = useRef(false);
  // Which face was showing last time this ran. `reduced` is a dependency — the
  // preference is a live subscription and can flip mid-session — but a change to
  // it is not a card turning over, and without this every mounted card in the
  // vault would light up the moment somebody switched the setting off.
  const lastFaceRef = useRef(showBack);

  useLayoutEffect(() => {
    // Not on mount. A card that arrives already face-down has not turned over,
    // and lighting one up as the vault scrolls past would be thirty cards
    // flaring at once.
    if (firstFaceRef.current) {
      firstFaceRef.current = false;
      lastFaceRef.current = showBack;
      return;
    }
    const turned = lastFaceRef.current !== showBack;
    lastFaceRef.current = showBack;
    if (reduced || !turned) return;
    if (!armedRef.current) {
      // First turn: the classes land on the next render and the animations play
      // simply by being attached.
      armedRef.current = true;
      setArmed(true);
      return;
    }
    // Every turn after that. A CSS animation runs when it is added to an element
    // and never again, so on a card that is already wearing the class the second
    // flip would light nothing at all.
    restartAnimation(cardRef.current);
    restartAnimation(sceneRef.current);
  }, [showBack, reduced]);

  const turning = armed && !reduced;

  function toggleFlip() {
    if (!canFlip) return;
    const next = !isFlipped;
    // A controlled card with no handler cannot turn: nothing moves, so the
    // sound would announce a flip that never happens.
    const willFlip = flipped === undefined || onFlippedChange !== undefined;
    if (flipped === undefined) setUncontrolledFlip(next);
    onFlippedChange?.(next);
    if (willFlip) playFlip();
  }

  function handleClick() {
    if (tapDisabled) return;
    // A flick already turned the card; the click the browser synthesises after
    // that same pointerup would turn it straight back.
    if (takeFlick()) return;
    onClick?.();
    if (!onClick) toggleFlip();
  }

  // A grid thumbnail gets half the foil of a full-bleed detail card: the same
  // overlay reads far heavier at small sizes, and nobody tilts a thumbnail.
  const scale = intensity === "subtle" ? 0.5 : 1;

  const edn = editionStyle(edition);

  const styleVars = {
    "--holo-a": rarity.holoA,
    "--holo-b": rarity.holoB,
    "--holo-sparkle": reduced ? 0 : rarity.sparkle * scale,
    // Resting sheen, kept low so the artwork reads as the artist drew it...
    "--holo-rest": (reduced ? 0.04 : 0.095) * rarity.strength * scale,
    // ...and the bloom it gains on top of that at full tilt. A base card peaks
    // near the old flat 0.38, but only while moving and only inside the band.
    "--holo-gain": reduced ? 0 : 0.4 * rarity.strength * scale,
    // Where the card is edge-on, which is where holo-face lands its visibility
    // swap. Two things move it: the flip's own length — a 1100ms secret turning
    // against a fixed 250ms default swaps faces a third of the way in — and the
    // curve, which is asymmetric, so this is 38% of the duration and not half of
    // it. See FLIP_EDGE_AT.
    "--holo-flip-half": `${Math.round(flipMs * FLIP_EDGE_AT)}ms`,
    // Read by the flip's own light, punch and shine keyframes in styles.css, so
    // all three stretch with the card that is turning rather than being written
    // for the roster's 500ms and running short on the secret's 1100ms.
    "--holo-flip-ms": `${flipMs}ms`,
    // The keyframes cannot reach `rarity.border` on their own.
    "--holo-edge": rarity.border,
    // The edition's own three, kept clear of the --holo-* set on purpose: the
    // tier and the finish are separate axes, and a shared variable is how they
    // would quietly start overwriting each other.
    "--edn-a": edn.metalA,
    "--edn-b": edn.metalB,
    "--edn-spec": edn.specular,
    // Late enough that the card has landed and you are looking at its face.
    "--holo-shine-delay": `${shineDelayMs ?? Math.round(flipMs * 0.82)}ms`,
    aspectRatio: CARD_ASPECT,
    touchAction,
  } as React.CSSProperties;

  // A resting card only crawls if the tier earned it, and only at hero size —
  // the vault grid is the one place many cards mount at once, and a permanently
  // animating layer on each is the same cost `engaged` exists to avoid. It also
  // yields the moment the pointer's own band takes over.
  const idle = rarity.idle && tilt === "hero" && !reduced && !engaged;

  // A hero card is the only thing on screen and is allowed its bloom whatever it
  // is; in a grid the bloom has to be earned. See the boxShadow below.
  const blooms = tilt === "hero";

  // A named variable rather than part of `Overlays`, because `Overlays` renders on
  // the front *and* on an uploaded back — inlining the ring there would mount two
  // of them on a secret card that has back art.
  const prismEdge = rarity.prismEdge ? (
    <div
      className={cn(
        "holo-prism-edge",
        tilt === "hero" && !reduced && BORDER_FX_CLASS[rarity.borderFx ?? "spin"],
      )}
      aria-hidden
    />
  ) : null;

  // Named for exactly the reason `prismEdge` above is, and it has to be listed
  // in both places that one is: `Overlays` covers the front and an uploaded
  // back, while a *generated* back re-renders a hand-picked subset below. Left
  // out of that subset the frame would simply vanish when a card with a
  // generated back is turned over.
  //
  // The animation class is added only at hero size — see the note on
  // EDITION_ANIM_CLASS, and the identical gate on `idle` above.
  const editionFrame =
    edition === "standard" ? null : (
      <div
        className={cn(
          "card-edition",
          EDITION_CLASS[edition],
          tilt === "hero" && !reduced && EDITION_ANIM_CLASS[edition],
        )}
        aria-hidden
      />
    );

  // The corner stamp, and the inverse gate to every other one in this file: it
  // exists *because* a tile is small. At hero size the finish already has a word
  // and a chip, and a stamp on a card you are holding reads as damage. Listed in
  // both places editionFrame is, for the same reason.
  const editionTab =
    edition === "standard" || tilt === "hero" ? null : (
      <div className="card-edition-tab" aria-hidden />
    );

  const Overlays = (
    <>
      <div className={cn("holo-foil", `holo-pattern-${rarity.pattern}`)} aria-hidden />
      {idle && <div className="holo-idle" aria-hidden />}
      {engaged && <div className="holo-glare" aria-hidden />}
      {engaged && rarity.sparkle > 0 && <div className="holo-sparkle" aria-hidden />}
      {prismEdge}
      {editionFrame}
      {editionTab}
    </>
  );

  return (
    <div
      ref={sceneRef}
      // The punch rides the scene because the two layers below both already own
      // a transform: the tilt is written imperatively by the pointer handlers,
      // and the flip is the rotation being punctuated.
      className={cn("holo-scene relative w-full select-none", turning && "holo-punch", className)}
      style={styleVars}
      {...handlers}
    >
      {/*
        Tilt and flip live on separate layers on purpose. The flip needs a ~500ms
        transition; the tilt must be instant or the card feels like it is dragging
        behind your finger. Sharing one element would force one duration on both.
      */}
      <div
        ref={tiltRef}
        className="h-full w-full [transform-style:preserve-3d]"
        style={{
          // translateZ leads: the lift is toward the viewer along the scene's Z,
          // not along the card's own normal after it has already rotated. It rides
          // the same transform the settle transition eases, so it costs nothing
          // extra — and it must not live on the flip layer below, whose 500ms
          // duration would smear the lift out and make the card feel gluey.
          // Same function list, in the same order, as applyTilt writes, so the
          // settle transition interpolates function by function.
          transform: "translateZ(0px) rotateX(0deg) rotateY(0deg)",
          // Gated to the hero card: thirty promoted layers is the exact cost the
          // rest of this file is written to avoid.
          willChange: tilt === "hero" ? "transform" : undefined,
        }}
      >
        <div
          ref={cardRef}
          role={canFlip || onClick ? "button" : undefined}
          tabIndex={canFlip || onClick ? 0 : undefined}
          aria-labelledby={titleId}
          aria-pressed={canFlip ? isFlipped : undefined}
          aria-disabled={tapDisabled || undefined}
          onClick={handleClick}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleClick();
            }
          }}
          className={cn(
            "relative h-full w-full rounded-xl border shadow-2xl outline-none",
            "transition-transform [transform-style:preserve-3d]",
            "focus-visible:ring-2 focus-visible:ring-primary",
            (canFlip || onClick) && !tapDisabled && "cursor-pointer",
            turning && "holo-turning",
            // The shine only fires on the way to the *front*. Turning a card back
            // over to read its stats is navigation, and a specular pass on it
            // would celebrate somebody checking a number.
            turning && !showBack && "holo-shine",
          )}
          style={{
            borderColor: rarity.border,
            transform: `rotateY(${showBack ? 180 : 0}deg)`,
            transitionDuration: reduced ? "0ms" : `${flipMs}ms`,
            transitionTimingFunction: FLIP_CURVE,
            // Additive, so the finish lifts the card's bloom without taking the
            // tier's glow away from it. Both axes get to be visible at once.
            //
            // A tile only gets either layer if its rank earned one (§8, "one
            // scale of glow"): every owned tile used to bloom in its tier
            // colour, so a shelf of base cards looked exactly as special as a
            // champion and nothing on the page was the top of anything. A card
            // at hero size is the exception — it is the only thing on screen,
            // and the bloom is what the reveal ceremony is made of.
            //
            // `undefined` rather than "none" when nothing is earned: the
            // element's own shadow-2xl still has to lift it off the page, and a
            // tile with no shadow at all reads as pasted on.
            boxShadow:
              [
                blooms || rarity.glow ? `0 0 28px -6px ${rarity.border}` : null,
                edn.lift > 0 && (blooms || edn.glow)
                  ? `0 0 ${Math.round(20 + edn.lift * 34)}px -8px ${edn.accent}`
                  : null,
              ]
                .filter(Boolean)
                .join(", ") || undefined,
          }}
        >
          <span id={titleId} className="sr-only">
            {name} — {rarity.label} card
            {editionLabel(edition) ? `, ${editionLabel(edition)}` : ""}
            {canFlip && !tapDisabled ? ", press to flip" : ""}
          </span>

          {/* Front. `invisible` rather than backface-visibility alone — see the
              note on .holo-face; WebKit shows the away side through the card. */}
          <div className={cn("holo-face", canFlip && showBack && "invisible")}>
            {frontSrc && !frontFailed ? (
              <img
                src={frontSrc}
                srcSet={frontSrcSet}
                sizes={imgSizes}
                alt={`${name} card front`}
                onError={front.onError}
                // A vault grid is thirty cards deep. Fetching and decoding the
                // ones below the fold up front is what starves the handful that
                // are actually on screen.
                loading={eager ? "eager" : "lazy"}
                decoding="async"
                fetchPriority={eager ? "high" : "auto"}
                className="h-full w-full object-cover"
                // Buys back the small amount of punch the blend layers still
                // cost, so the art lands closer to the source file.
                style={{ filter: "saturate(1.06) contrast(1.04)" }}
                draggable={false}
              />
            ) : (
              <CardPlaceholder name={name} label="No card art" />
            )}
            {Overlays}
          </div>

          {/* Back — skipped entirely on a card that can't turn over, which is every
              thumbnail in the vault grid. */}
          {(canFlip || faceDown) && (
            <div className={cn("holo-face [transform:rotateY(180deg)]", !showBack && "invisible")}>
              {backSrc && !backFailed ? (
                <img
                  src={backSrc}
                  srcSet={backSrcSet}
                  sizes={imgSizes}
                  alt={`${name} card back`}
                  onError={back.onError}
                  loading="lazy"
                  decoding="async"
                  // object-cover, not contain: the card's aspect is measured from
                  // the front art, and one universal back shared across an event
                  // won't always match it exactly. Contain would letterbox the
                  // back against the card body; cover keeps it full-bleed.
                  className="h-full w-full object-cover"
                  style={{ filter: "saturate(1.06) contrast(1.04)" }}
                  draggable={false}
                />
              ) : (
                (backContent ?? <CardPlaceholder name={name} label="No back art" />)
              )}
              {/* Uploaded art gets the full foil treatment; a generated back only
                takes the glare, so the stats stay legible. The prism edge rides
                along either way: it traces the bezel and never sits over the
                panel, so the reason the foil is held back here doesn't apply. */}
              {backSrc && !backFailed ? (
                Overlays
              ) : (
                <>
                  {engaged && <div className="holo-glare" aria-hidden />}
                  {prismEdge}
                  {editionFrame}
                  {editionTab}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// The vault renders the whole roster at once, and its parent re-renders on every
// sort, every collection read and every signed-URL refresh. None of that changes
// a card, so none of it should cost thirty re-renders.
export const HoloCard = memo(HoloCardImpl);

function CardPlaceholder({ name, label }: { name: string; label: string }) {
  return (
    <div className="surface-panel flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center">
      <div className="font-display text-4xl font-black uppercase text-primary/60">
        {initialsOf(name) || "?"}
      </div>
      <div className="font-display text-sm font-black uppercase leading-tight tracking-wide">
        {name}
      </div>
      <div className="text-label font-bold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </div>
    </div>
  );
}
