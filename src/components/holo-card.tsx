import { useCallback, useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { initialsOf } from "@/lib/format";
import { loadCardMeta, saveCardMeta } from "@/lib/card-collection";
import { playFlip } from "@/lib/card-sfx";
import type { Rarity } from "@/lib/card-rarity";

/** Standard trading card is 2.5in x 3.5in. Used until the real art reports its size. */
const DEFAULT_ASPECT = 5 / 7;

/** Maximum tilt in degrees at the edges of the card. */
const MAX_TILT = 12;

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

export function HoloCard({
  frontUrl,
  backUrl,
  name,
  rarity,
  cacheKey,
  flipped,
  onFlippedChange,
  interactive = true,
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
  const reduced = usePrefersReducedMotion();
  const titleId = useId();

  const [aspect, setAspect] = useState<number | null>(null);
  const [uncontrolledFlip, setUncontrolledFlip] = useState(false);
  const isFlipped = flipped ?? uncontrolledFlip;
  const showBack = faceDown ? !isFlipped : isFlipped;
  // A generated back is just as flippable as uploaded back artwork.
  const canFlip = !!backUrl || !!backContent;

  // Restore the cached aspect ratio before the image loads so the grid never reflows.
  useEffect(() => {
    if (!cacheKey) return;
    let cancelled = false;
    loadCardMeta(cacheKey).then((meta) => {
      if (!cancelled && meta?.aspect) setAspect(meta.aspect);
    });
    return () => {
      cancelled = true;
    };
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
  // off React's render path entirely.
  const applyTilt = useCallback((px: number, py: number) => {
    const scene = sceneRef.current;
    const card = cardRef.current;
    if (!scene || !card) return;
    const rx = (0.5 - py) * 2 * MAX_TILT;
    const ry = (px - 0.5) * 2 * MAX_TILT;
    scene.style.setProperty("--holo-rx", `${rx.toFixed(2)}deg`);
    scene.style.setProperty("--holo-ry", `${ry.toFixed(2)}deg`);
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
        if (p) applyTilt(p.px, p.py);
      });
    },
    [applyTilt],
  );

  const resetTilt = useCallback(() => {
    if (frameRef.current != null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    applyTilt(0.5, 0.5);
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
    let baseline: { beta: number; gamma: number } | null = null;
    const onOrient = (e: DeviceOrientationEvent) => {
      const { beta, gamma } = e;
      if (beta == null || gamma == null) return;
      if (!baseline) {
        baseline = { beta, gamma };
        return;
      }
      const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
      schedule(
        clamp01(0.5 + (gamma - baseline.gamma) / 45),
        clamp01(0.5 + (beta - baseline.beta) / 40),
      );
    };
    window.addEventListener("deviceorientation", onOrient);
    return () => window.removeEventListener("deviceorientation", onOrient);
  }, [gyro, reduced, schedule]);

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!interactive || reduced) return;
    const r = e.currentTarget.getBoundingClientRect();
    if (!r.width || !r.height) return;
    schedule((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
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

  const styleVars = {
    "--holo-a": rarity.holoA,
    "--holo-b": rarity.holoB,
    "--holo-sparkle": reduced ? 0 : rarity.sparkle,
    "--holo-strength": reduced ? 0.18 : 0.38,
    aspectRatio: aspect ?? DEFAULT_ASPECT,
  } as React.CSSProperties;

  const Overlays = (
    <>
      <div className="holo-foil" aria-hidden />
      <div className="holo-glare" aria-hidden />
      {rarity.sparkle > 0 && <div className="holo-sparkle" aria-hidden />}
    </>
  );

  return (
    <div
      ref={sceneRef}
      className={cn("holo-scene relative w-full select-none", className)}
      style={styleVars}
      onPointerMove={handlePointerMove}
      onPointerLeave={resetTilt}
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
                className="h-full w-full object-cover"
                draggable={false}
              />
            ) : (
              <CardPlaceholder name={name} label="No card art" />
            )}
            {Overlays}
          </div>

          {/* Back */}
          <div className="holo-face [transform:rotateY(180deg)]">
            {backUrl ? (
              <img
                src={backUrl}
                alt={`${name} card back`}
                crossOrigin="anonymous"
                className="h-full w-full object-contain"
                draggable={false}
              />
            ) : (
              (backContent ?? <CardPlaceholder name={name} label="No back art" />)
            )}
            {/* Uploaded art gets the full foil treatment; a generated back only
                takes the glare, so the stats stay legible. */}
            {backUrl ? Overlays : <div className="holo-glare" aria-hidden />}
          </div>
        </div>
      </div>
    </div>
  );
}

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
