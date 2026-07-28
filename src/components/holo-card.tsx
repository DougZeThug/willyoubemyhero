import { memo, useCallback, useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { initialsOf } from "@/lib/format";
import { cachedCardMeta, primeCardMeta, saveCardMeta } from "@/lib/card-collection";
import { playFlip } from "@/lib/card-sfx";
import type { Rarity } from "@/lib/card-rarity";

/** Standard trading card is 2.5in x 3.5in. Used until the real art reports its size. */
const DEFAULT_ASPECT = 5 / 7;

/** Maximum tilt in degrees at the edges of the card. */
const MAX_TILT = 16;

/**
 * How much further a finger drag tilts the card than the same distance of mouse
 * travel. A mouse sweeps the whole card and reaches the edges on its own; a thumb
 * plants somewhere near the middle and wiggles maybe a centimetre, which under
 * plain position mapping is a couple of degrees — the card barely moves. Touch is
 * therefore tracked as amplified displacement from wherever the finger landed.
 */
const TOUCH_GAIN = 2.6;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export type HoloCardProps = {
  frontUrl: string | null;
  backUrl: string | null;
  name: string;
  rarity: Rarity;
  /** Stable id used to cache the measured aspect ratio between visits. */
  cacheKey?: string;
  /** Controlled flip state. Omit for an uncontrolled card. */
  flipped?: boolean;
  onFlippedChange?: (next: boolean) => void;
  /** Whether the card responds to pointer tilt. */
  interactive?: boolean;
  /**
   * Whether a finger drag tilts the card. Defaults on for full-size cards and off
   * for grid thumbnails, where claiming the gesture would fight the page scroll.
   */
  touchTilt?: boolean;
  /**
   * How loud the foil is. "subtle" halves it for small, mostly-non-interactive
   * cards like the vault grid, where a full-strength overlay swamps the artwork.
   */
  intensity?: "full" | "subtle";
  /** Device-orientation tilt, enabled by the caller after a permission grant. */
  gyro?: boolean;
  /** Start face-down (shows the back) regardless of art availability. */
  faceDown?: boolean;
  /** Rendered on the back face when there is no uploaded back artwork. */
  backContent?: React.ReactNode;
  className?: string;
  onClick?: () => void;
};

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

function HoloCardImpl({
  frontUrl,
  backUrl,
  name,
  rarity,
  cacheKey,
  flipped,
  onFlippedChange,
  interactive = true,
  touchTilt,
  intensity = "full",
  gyro = false,
  faceDown = false,
  backContent,
  className,
  onClick,
}: HoloCardProps) {
  const sceneRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const pendingRef = useRef<{ px: number; py: number } | null>(null);
  const dragRef = useRef<{ id: number; px: number; py: number } | null>(null);
  const reduced = usePrefersReducedMotion();
  const titleId = useId();

  // A full-size card is meant to be handled; a thumbnail in a scrolling grid is not.
  const dragTilt = touchTilt ?? intensity === "full";
  // The grid is the one place many cards mount at once, and it is the one place
  // the art is small enough that off-screen work is pure waste.
  const eager = intensity === "full";

  // Reading straight out of the in-memory cache means a revisit lays the grid out
  // at the right size on the first render, with no async round trip and no reflow.
  const [aspect, setAspect] = useState<number | null>(
    () => cachedCardMeta(cacheKey)?.aspect ?? null,
  );
  const [uncontrolledFlip, setUncontrolledFlip] = useState(false);
  // The glare and sparkle layers are invisible until the card moves, and each one
  // is a blend-mode layer the compositor has to carry. Thirty cards' worth of them
  // at first paint is what makes the vault crawl on a phone, so they are not
  // mounted until the card is actually being handled.
  const [engaged, setEngaged] = useState(false);
  const isFlipped = flipped ?? uncontrolledFlip;
  const showBack = faceDown ? !isFlipped : isFlipped;
  // A generated back is just as flippable as uploaded back artwork.
  const canFlip = !!backUrl || !!backContent;

  // Restore the cached aspect ratio before the image loads so the grid never reflows.
  useEffect(() => {
    if (!cacheKey || aspect != null) return;
    let cancelled = false;
    primeCardMeta().then(() => {
      const meta = cachedCardMeta(cacheKey);
      if (!cancelled && meta?.aspect) setAspect(meta.aspect);
    });
    return () => {
      cancelled = true;
    };
    // Only ever runs for a card whose ratio is still unknown; re-running it once
    // the image has reported its own size would be pointless work.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

  const onImageLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      const img = e.currentTarget;
      if (!img.naturalWidth || !img.naturalHeight) return;
      const next = img.naturalWidth / img.naturalHeight;
      setAspect(next);
      if (cacheKey) void saveCardMeta(cacheKey, { aspect: next });
    },
    [cacheKey],
  );

  // px/py are 0..1 across the card. Writing CSS variables directly keeps this
  // off React's render path entirely. `active` is 1 while the card is being
  // moved and 0 once it settles; every foil layer scales by it, so a card at
  // rest shows the artwork almost clean and only blooms when you tilt it.
  const applyTilt = useCallback((px: number, py: number, active: number) => {
    const scene = sceneRef.current;
    const card = cardRef.current;
    if (!scene || !card) return;
    const rx = (0.5 - py) * 2 * MAX_TILT;
    const ry = (px - 0.5) * 2 * MAX_TILT;
    scene.style.setProperty("--holo-rx", `${rx.toFixed(2)}deg`);
    scene.style.setProperty("--holo-ry", `${ry.toFixed(2)}deg`);
    card.style.setProperty("--holo-active", `${active}`);
    card.style.setProperty("--holo-gx", `${(px * 100).toFixed(1)}%`);
    card.style.setProperty("--holo-gy", `${(py * 100).toFixed(1)}%`);
    card.style.setProperty("--holo-pos", `${(px * 100).toFixed(1)}%`);
    // Sparkle parallaxes at ~2x so glints crawl independently of the bands.
    card.style.setProperty("--holo-sparkle-x", `${(px * 200 - 50).toFixed(1)}%`);
    card.style.setProperty("--holo-sparkle-y", `${(py * 200 - 50).toFixed(1)}%`);
  }, []);

  const schedule = useCallback(
    (px: number, py: number) => {
      pendingRef.current = { px, py };
      if (frameRef.current != null) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        const p = pendingRef.current;
        if (p) applyTilt(p.px, p.py, 1);
      });
    },
    [applyTilt],
  );

  // Recentre and fade the foil back out. The CSS opacity transition does the
  // easing, so there is nothing to animate here.
  const resetTilt = useCallback(() => {
    if (frameRef.current != null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    dragRef.current = null;
    applyTilt(0.5, 0.5, 0);
  }, [applyTilt]);

  useEffect(() => {
    return () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  // Device orientation, offset from the first reading so it works at any resting
  // angle — standing at the bar or lying on the couch.
  useEffect(() => {
    if (!gyro || reduced || typeof window === "undefined") return;
    setEngaged(true);
    let baseline: { beta: number; gamma: number } | null = null;
    const onOrient = (e: DeviceOrientationEvent) => {
      const { beta, gamma } = e;
      if (beta == null || gamma == null) return;
      if (!baseline) {
        baseline = { beta, gamma };
        return;
      }
      // Roughly a 20° roll of the phone sweeps the card corner to corner. Wider
      // than this and normal handling reads as a dead card.
      schedule(
        clamp01(0.5 + (gamma - baseline.gamma) / 26),
        clamp01(0.5 + (beta - baseline.beta) / 24),
      );
    };
    window.addEventListener("deviceorientation", onOrient);
    return () => window.removeEventListener("deviceorientation", onOrient);
  }, [gyro, reduced, schedule]);

  function localPoint(e: React.PointerEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { px: (e.clientX - r.left) / r.width, py: (e.clientY - r.top) / r.height };
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!interactive || reduced || e.pointerType === "mouse" || !dragTilt) return;
    const p = localPoint(e);
    if (!p) return;
    dragRef.current = { id: e.pointerId, px: p.px, py: p.py };
    // Capture so the tilt keeps tracking once the finger slides past the card's
    // edge, and so a drag that started here isn't handed off mid-gesture.
    e.currentTarget.setPointerCapture?.(e.pointerId);
    // Mounted now, a frame before anything moves, so the overlays still get to
    // fade in rather than snapping on with the first tilt.
    setEngaged(true);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!interactive || reduced) return;
    const drag = dragRef.current;
    // Hover tilts on a mouse; touch and pen only tilt while a finger is down,
    // otherwise a stray move event would leave the card cocked over.
    if (e.pointerType !== "mouse" && (!drag || drag.id !== e.pointerId)) return;
    const p = localPoint(e);
    if (!p) return;
    setEngaged(true);
    if (drag) {
      schedule(
        clamp01(drag.px + (p.px - drag.px) * TOUCH_GAIN),
        clamp01(drag.py + (p.py - drag.py) * TOUCH_GAIN),
      );
      return;
    }
    schedule(p.px, p.py);
  }

  function handlePointerEnd(e: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.id === e.pointerId && e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    resetTilt();
  }

  function toggleFlip() {
    if (!canFlip) return;
    const next = !isFlipped;
    if (flipped === undefined) setUncontrolledFlip(next);
    onFlippedChange?.(next);
    playFlip();
  }

  function handleClick() {
    onClick?.();
    if (!onClick) toggleFlip();
  }

  // A grid thumbnail gets half the foil of a full-bleed detail card: the same
  // overlay reads far heavier at small sizes, and nobody tilts a thumbnail.
  const scale = intensity === "subtle" ? 0.5 : 1;

  const styleVars = {
    "--holo-a": rarity.holoA,
    "--holo-b": rarity.holoB,
    "--holo-sparkle": reduced ? 0 : rarity.sparkle * scale,
    // Resting sheen, kept low so the artwork reads as the artist drew it...
    "--holo-rest": (reduced ? 0.04 : 0.095) * rarity.strength * scale,
    // ...and the bloom it gains on top of that at full tilt. A base card peaks
    // near the old flat 0.38, but only while moving and only inside the band.
    "--holo-gain": reduced ? 0 : 0.4 * rarity.strength * scale,
    aspectRatio: aspect ?? DEFAULT_ASPECT,
    // Vertical drags still scroll the page; anything with sideways intent is the
    // card's. Without this the browser claims the gesture as a scroll a few pixels
    // in and cancels the pointer stream, which is why a thumb barely moved the card.
    touchAction: dragTilt && interactive && !reduced ? "pan-y" : undefined,
  } as React.CSSProperties;

  const Overlays = (
    <>
      <div className="holo-foil" aria-hidden />
      {engaged && <div className="holo-glare" aria-hidden />}
      {engaged && rarity.sparkle > 0 && <div className="holo-sparkle" aria-hidden />}
    </>
  );

  return (
    <div
      ref={sceneRef}
      className={cn("holo-scene relative w-full select-none", className)}
      style={styleVars}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onPointerLeave={handlePointerEnd}
    >
      {/*
        Tilt and flip live on separate layers on purpose. The flip needs a ~500ms
        transition; the tilt must be instant or the card feels like it is dragging
        behind your finger. Sharing one element would force one duration on both.
      */}
      <div
        className="h-full w-full [transform-style:preserve-3d]"
        style={{
          transform: "rotateX(var(--holo-rx,0deg)) rotateY(var(--holo-ry,0deg))",
        }}
      >
        <div
          ref={cardRef}
          role={canFlip || onClick ? "button" : undefined}
          tabIndex={canFlip || onClick ? 0 : undefined}
          aria-labelledby={titleId}
          aria-pressed={canFlip ? isFlipped : undefined}
          onClick={handleClick}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleClick();
            }
          }}
          className={cn(
            "relative h-full w-full rounded-xl border shadow-2xl outline-none",
            "transition-transform duration-500 ease-out [transform-style:preserve-3d]",
            "focus-visible:ring-2 focus-visible:ring-primary",
            (canFlip || onClick) && "cursor-pointer",
          )}
          style={{
            borderColor: rarity.border,
            transform: `rotateY(${showBack ? 180 : 0}deg)`,
            transitionDuration: reduced ? "0ms" : undefined,
            boxShadow: `0 0 28px -6px ${rarity.border}`,
          }}
        >
          <span id={titleId} className="sr-only">
            {name} — {rarity.label} card{canFlip ? ", press to flip" : ""}
          </span>

          {/* Front */}
          <div className="holo-face">
            {frontUrl ? (
              <img
                src={frontUrl}
                alt={`${name} card front`}
                crossOrigin="anonymous"
                onLoad={onImageLoad}
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
            <div className="holo-face [transform:rotateY(180deg)]">
              {backUrl ? (
                <img
                  src={backUrl}
                  alt={`${name} card back`}
                  crossOrigin="anonymous"
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
                takes the glare, so the stats stay legible. */}
              {backUrl ? Overlays : engaged && <div className="holo-glare" aria-hidden />}
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
    <div className="hud-bezel flex h-full w-full flex-col items-center justify-center gap-2 bg-[oklch(0.16_0.02_240)] p-4 text-center">
      <div className="font-display text-4xl font-black uppercase text-primary/60">
        {initialsOf(name) || "?"}
      </div>
      <div className="font-display text-sm font-black uppercase leading-tight tracking-wide">
        {name}
      </div>
      <div className="text-[9px] font-bold uppercase tracking-[0.3em] text-muted-foreground">
        {label}
      </div>
    </div>
  );
}
