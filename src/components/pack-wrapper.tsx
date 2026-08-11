import { useCallback, useRef, useState } from "react";
import { motion } from "motion/react";
import { Sparkles } from "lucide-react";
import { playTearTick } from "@/lib/card-sfx";
import { seededRng } from "@/lib/format";
import { TEAR, tearProgress } from "@/lib/pack";
import { ceremonyReached, type CeremonyPhase } from "@/lib/pack-ceremony";
import { urlFromSet } from "@/lib/media";
import type { ImageUrlSet } from "@/lib/media";
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";

/** How often a crinkle fires across the rip, as a fraction of the travel. */
const TICK_EVERY = 0.12;

type TearPoint = { x: number; y: number };

/**
 * The ragged line the wrapper separates along.
 *
 * Seeded, so a given pack always tears the same way — the same property the old
 * vertical wipe had, and worth keeping: two people opening the same pack side by
 * side should see the same rip.
 *
 * 27 steps rather than 16, and two octaves of jitter rather than one. A single
 * amplitude at low resolution reads as a zigzag; the coarse wander gives the rip
 * its shape and the fine one gives it fibre. 27 also divides into clean thirds at
 * 0/9/18/27, which is where the strip breaks apart — see SHARDS.
 */
function tearEdge(rng: () => number, stripPct: number): TearPoint[] {
  const steps = 27;
  const points: TearPoint[] = [];
  for (let i = 0; i <= steps; i++) {
    points.push({
      x: (i / steps) * 100,
      // Kept off the very top edge, or a deep jitter clips the strip away to
      // nothing at that column and the tear reads as a hole rather than a rip.
      y: Math.max(1.5, stripPct + (rng() - 0.5) * 4.5 + (rng() - 0.5) * 1.6),
    });
  }
  return points;
}

const fmt = (p: TearPoint) => `${p.x.toFixed(1)}% ${p.y.toFixed(1)}%`;

/** Everything above the tear line — the piece that peels away. */
function stripClip(points: TearPoint[]): string {
  return `polygon(0% 0%, 100% 0%, ${[...points].reverse().map(fmt).join(", ")})`;
}

/** Everything below it — the pack, which never moves. */
function bodyClip(points: TearPoint[]): string {
  return `polygon(${points.map(fmt).join(", ")}, 100% 100%, 0% 100%)`;
}

/**
 * The exposed fibre along the rip.
 *
 * A thin band that follows the tear line, drawn between the body and the strip so
 * it is only visible once the strip has moved off it. Torn card stock shows a
 * bright core where the printed surface has parted, and it is the one detail that
 * separates "torn" from "cut" — without it the ragged polygon still reads as a
 * very carefully cut edge.
 */
function coreClip(points: TearPoint[]): string {
  const under = points.map((p) => ({ x: p.x, y: p.y + 1.4 }));
  return `polygon(${points.map(fmt).join(", ")}, ${[...under].reverse().map(fmt).join(", ")})`;
}

/**
 * The opening, as a clip for whatever is coming out of it.
 *
 * The same ragged line the pack tore along, so a card on its way out is cut by
 * the tear itself rather than by a tidy horizontal edge. `open` slides that line
 * down and off the bottom, which is what lets the cards finish emerging without
 * the clip popping off in one frame.
 *
 * The vertex count is constant across every value of `open` — that is the whole
 * reason this is one function rather than two clip strings, because motion can
 * only interpolate two polygons that agree on how many corners they have.
 *
 * Left and right run well past the pack so the fan can spread outside it once the
 * clip is open; only the top edge is ever doing any work.
 */
function mouthClip(points: TearPoint[], open: number): string {
  const drop = open * 150;
  const at = (p: TearPoint) => `${p.x.toFixed(1)}% ${(p.y + drop).toFixed(1)}%`;
  const line = [...points].reverse().map(at);
  const right = `150% ${(points[points.length - 1].y + drop).toFixed(1)}%`;
  const left = `-50% ${(points[0].y + drop).toFixed(1)}%`;
  return `polygon(-50% -120%, 150% -120%, ${right}, ${line.join(", ")}, ${left})`;
}

/**
 * One shard of the strip: the slice of the tear line between two columns.
 *
 * Adjacent shards share their boundary vertices, so while they are still together
 * there is no seam to see — they separate only because they animate apart, which
 * is what makes the break look like a break rather than a reveal of three pieces
 * that were always there.
 */
function shardClip(points: TearPoint[], from: number, to: number): string {
  const span = points.slice(from, to + 1);
  const a = span[0].x;
  const b = span[span.length - 1].x;
  return `polygon(${a.toFixed(1)}% 0%, ${b.toFixed(1)}% 0%, ${[...span].reverse().map(fmt).join(", ")})`;
}

const SHARDS = [
  [0, 9],
  [9, 18],
  [18, 27],
] as const;

/**
 * Where each shard ends up.
 *
 * Not a fan of three equal arcs: real foil comes off in pieces that disagree with
 * each other, and three tidy parallel flights read as an animation rather than as
 * something coming apart.
 */
const SHARD_FLIGHT = [
  // `sec`, not ms — motion's own unit for a duration, and mixing the two here is
  // a thousandfold mistake that looks like a frozen animation.
  //
  // Sized against `peel` plus the phase after it: the shards are allowed to still
  // be tumbling once the cards have started to rise, because foil coming off a
  // pack does not politely finish before the contents move. What they must not do
  // is outlive the fan — a shard still in the air behind a spread hand of cards
  // reads as a stray element rather than as debris.
  { x: -74, y: -196, rz: -34, rx: 52, sec: 0.44 },
  { x: 24, y: -238, rz: 22, rx: 38, sec: 0.48 },
  { x: 98, y: -176, rz: 48, rx: 64, sec: 0.4 },
] as const;

/**
 * The printed face of the pack, drawn once per layer.
 *
 * The wax foil underneath is the designed fallback, not a spinner: a slow network
 * gets a beautiful pack rather than a grey box, and an event with no uploaded back
 * gets the same thing permanently.
 *
 * The lettering hides on `loaded`, never on "an art URL exists". A cached image
 * completes before React attaches onLoad, and an expired signed URL never
 * completes at all — both used to leave a blank foil with the caption already
 * hidden, which is what "the universal back isn't showing" looked like.
 */
function PackFace({ art, size, year }: { art: string | null; size: number; year: string }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  // Runs on mount too, so an image the browser already had decoded — which fires
  // its load event before the handler exists — still reports itself.
  const settle = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth > 0) setLoaded(true);
  }, []);
  const showArt = !!art && !failed;
  return (
    <div className="wax-foil absolute inset-0">
      {showArt && (
        <img
          ref={settle}
          src={art}
          alt=""
          aria-hidden
          crossOrigin="anonymous"
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={cn(
            "absolute inset-0 h-full w-full object-cover transition-opacity duration-300",
            loaded ? "opacity-100" : "opacity-0",
          )}
        />
      )}
      <div
        className={cn(
          "relative flex h-full flex-col items-center justify-center gap-2 p-6 text-center",
          // The lettering is the pack's identity until real art is actually on
          // screen. Over a loaded back it is a caption nobody asked for.
          showArt && loaded && "hidden",
        )}
      >
        <Sparkles className="h-8 w-8 text-primary" />
        <div className="font-display text-xs font-black uppercase tracking-[0.35em] text-primary/90">
          Will YOU Be My Hero?
        </div>
        <div className="font-display text-3xl font-black uppercase leading-none">Draft Combine</div>
        <div className="font-display text-[10px] font-bold uppercase tracking-[0.3em] text-muted-foreground">
          {size} cards · {year}
        </div>
      </div>
    </div>
  );
}

/**
 * The sealed pack, and the rip that opens it.
 *
 * The gesture is horizontal travel along a perforation near the top, measured
 * from where the finger landed. The version before this compared the pointer's
 * absolute Y against the pack's own top edge, which meant a tap two thirds of the
 * way down opened the pack having travelled nowhere — there was no drag to fail.
 *
 * Once the rip commits the component stops being a control and becomes scenery:
 * `phase` is driven from outside by the ceremony clock, and everything that made
 * this a button is dropped. A pack you can no longer tear must not still announce
 * itself as "Tear the pack open" — and the e2e suite reads exactly that role to
 * mean "still sealed".
 */
export function PackWrapper({
  seed,
  artUrl,
  packSize,
  year,
  phase,
  onTear,
  children,
}: {
  /** Pack seed, so the ragged edge is stable for a given pack. */
  seed: string;
  artUrl: ImageUrlSet | null;
  packSize: number;
  year: string;
  /**
   * Null while the pack is still sealed and tearable; a ceremony phase once the
   * rip has committed.
   */
  phase: CeremonyPhase | null;
  onTear: () => void;
  /**
   * Whatever is coming out of the pack.
   *
   * Rendered here rather than beside the pack because only this component knows
   * where its own mouth is: the children are clipped to the tear line while they
   * are still inside, which is what makes them read as *emerging* rather than as
   * appearing on top.
   */
  children?: React.ReactNode;
}) {
  const packRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: number; x: number } | null>(null);
  const tickRef = useRef(0);
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  /**
   * How far the rip had actually got when it committed.
   *
   * Read once, by the strip that finishes the job. The committed strip is a
   * *different element* from the one under the finger — it has to be, because the
   * one under the finger lives inside the pack's clipped box and this one cannot —
   * so there is no transition to inherit and a plain style would paint it at full
   * travel on its first frame. Which is what "the last 40% of the rip doesn't
   * animate" looked like: a jump, then a glow racing across on its own.
   *
   * Zero on the keyboard path, where nothing was dragged and the whole rip is the
   * ceremony's to play.
   */
  const committedAt = useRef(0);
  const reduced = usePrefersReducedMotion();

  const stripPct = TEAR.stripH * 100;
  const edge = tearEdge(seededRng(seed), stripPct);
  const art = urlFromSet(artUrl);

  const sealed = phase == null;
  // The pack takes the strain before anything comes apart. Two phases of nothing
  // *moving* would be a dead start, so this is where the anticipation lives: a
  // squash, then a seam that lights up under tension. It is also the beat that
  // makes the rip afterwards read as a release rather than as the first thing
  // that happens.
  const bracing = !sealed && !ceremonyReached("rip", phase);
  // The seam phase itself, not "seam or later". `ceremonyReached` is cumulative,
  // which is right for `shed` and `spilled` — those are one-way doors — and wrong
  // here: the seam is supposed to build, then be blown out by the rip it was
  // announcing. Asked cumulatively it stayed lit at full brightness through the
  // rip, the peel, the fan and the handoff, and the blow-out branch below was
  // unreachable.
  const seaming = phase === "seam";
  // The rip finishes travelling on its own once it commits. This is the whole
  // reason the ceremony exists: the threshold is 60% of the drag, so left to the
  // gesture alone the edge never crosses the last 40% of the pack and the strip
  // comes off having barely moved.
  const shed = !sealed && ceremonyReached("peel", phase);
  // The mouth stops holding on to what came out of it. Timed to the fan, which is
  // the beat the cards stop rising and start spreading — by then they are clear
  // of the pack and the clip has nothing left to hide.
  const spilled = !sealed && ceremonyReached("fan", phase);
  // The rip holds exactly where the finger left it until `rip` starts. Without
  // this the strip completes its travel during the two anticipation phases, so
  // the pack braces and tears in the same breath and the anticipation is spent on
  // something already over.
  const travel = sealed || bracing ? progress : 1;

  function end(e: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.id === e.pointerId && e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    dragRef.current = null;
    setDragging(false);
    // Short of the threshold the foil springs shut. Losing the progress is the
    // point: a rip you did not finish is a pack you did not open.
    setProgress(0);
  }

  // Rotating about the right edge is what makes this read as tearing rather than
  // sliding: the left end lifts while the right is still stuck down, which is the
  // shape a real wrapper takes when you rip it left to right.
  const lift = reduced ? 0 : travel;
  const stripStyle: React.CSSProperties = {
    clipPath: stripClip(edge),
    transformOrigin: "right center",
    transform: `rotate(${(-lift * 8).toFixed(2)}deg) translateY(${(-lift * 14).toFixed(1)}px)`,
    opacity: reduced ? 1 - travel : 1,
    // Eased rather than tracked once the finger is off it — during the ceremony
    // that is what carries the edge across the rest of the pack. Matched to the
    // `rip` phase so the strip is still travelling when the shards take over.
    transition: dragging ? undefined : "transform 500ms cubic-bezier(0.22, 1, 0.36, 1)",
  };

  return (
    <div
      ref={packRef}
      // Dropped wholesale the instant the rip commits, rather than disabled. A
      // sealed pack is a button; an opening one is a short film.
      role={sealed ? "button" : undefined}
      tabIndex={sealed ? 0 : undefined}
      aria-label={sealed ? "Tear the pack open" : undefined}
      aria-hidden={sealed ? undefined : true}
      onKeyDown={
        sealed
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onTear();
              }
            }
          : undefined
      }
      onPointerDown={
        sealed
          ? (e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              dragRef.current = { id: e.pointerId, x: e.clientX };
              tickRef.current = 0;
              setDragging(true);
            }
          : undefined
      }
      onPointerMove={
        sealed
          ? (e) => {
              const drag = dragRef.current;
              const rect = packRef.current?.getBoundingClientRect();
              if (!drag || drag.id !== e.pointerId || !rect) return;

              const p = tearProgress(drag.x, e.clientX, rect.width);
              setProgress(p);

              // One crinkle per step of the rip rather than one per pointermove,
              // which would fire sixty times a second and sound like static.
              const tick = Math.floor(p / TICK_EVERY);
              if (tick > tickRef.current) {
                tickRef.current = tick;
                playTearTick();
              }

              if (p >= TEAR.threshold) {
                dragRef.current = null;
                setDragging(false);
                // Where the strip that takes over has to start from.
                committedAt.current = p;
                // The capture used to be released by the pointerup landing on
                // `end()`. From here on this element has no handlers left, so
                // release it now or the capture outlives the gesture that took it
                // and the next tap anywhere on the page goes to a dead node.
                if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
                  e.currentTarget.releasePointerCapture(e.pointerId);
                }
                onTear();
              }
            }
          : undefined
      }
      onPointerUp={sealed ? end : undefined}
      onPointerCancel={sealed ? end : undefined}
      className={cn(
        // No overflow-hidden and no background: the shards have to leave this box,
        // and the cards behind it have to be occluded by it in 3D rather than
        // clipped by it in 2D. Both live on the inner box below.
        // Card-shaped, not pack-shaped: the wax foil sits directly over the
        // universal back, and a 3/4 wrapper made the sealed pack a different
        // silhouette from the cards that come out of it.
        "hud-glow relative aspect-[5/7] w-full max-w-xs rounded-2xl border border-primary/40",
        sealed && "cursor-grab touch-none active:cursor-grabbing",
      )}
      style={{
        // An explicit 3D-positioned box, so the shards inside it inherit the scene
        // camera rather than tumbling flat.
        //
        // The squash is the anticipation: a pack braced against the pull, wider
        // and shorter for a moment, before it lets go. Origin at the bottom so it
        // reads as being pressed down onto the table rather than shrinking in
        // place. Tiny on purpose — 3% is under the threshold at which it reads as
        // a wobble and well over the one at which the eye notices something
        // happened.
        transform: [
          "translateZ(0px)",
          `rotateX(${!sealed && !reduced ? -4 : 0}deg)`,
          bracing && !reduced ? "scale(1.02, 0.97)" : "scale(1, 1)",
        ].join(" "),
        transformOrigin: "50% 100%",
        transformStyle: "preserve-3d",
        transition: `transform ${bracing ? 120 : 300}ms cubic-bezier(0.22, 1, 0.36, 1)`,
      }}
    >
      {/* Everything that belongs *inside* the pack. Clipped and rounded here so
          the root can let the shards out.

          It dims once its cards are out. An emptied wrapper competing at full
          brightness with the fan in front of it is the difference between three
          cards being held up and three cards lying on a poster. */}
      <motion.div
        className="absolute inset-0 overflow-hidden rounded-2xl bg-background"
        initial={false}
        animate={{ opacity: spilled && !reduced ? 0.42 : 1 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
      >
        {/* The inside of the pack, exposed as the strip peels off it. Sits at the
            bottom of the stack so it is simply what is left once the foil moves. */}
        <div aria-hidden className="absolute inset-0 bg-black">
          <div
            className="absolute inset-x-0 top-0 bg-gradient-to-b from-primary/25 to-transparent"
            style={{ height: `${stripPct + 10}%` }}
          />
        </div>

        {/* The pack itself, which never moves — except to drop a few pixels as the
            strip goes the other way. Two halves separating is what sells it; one
            half moving alone reads as a slide. */}
        <motion.div
          aria-hidden
          className="absolute inset-0"
          style={{
            clipPath: bodyClip(edge),
            // Bowing needs somewhere to bow from. Hinged at the bottom, where the
            // pack is still held, so the torn top edge is the end that opens
            // toward the viewer.
            transformOrigin: "50% 100%",
            transformStyle: "preserve-3d",
          }}
          animate={
            shed && !reduced
              ? // The front face bends outward as the strip leaves it. A wrapper
                // that stayed perfectly flat while its top came off read as two
                // pieces sliding apart; this is the one detail that makes the pack
                // read as having been under tension.
                { y: 6, scale: 0.99, rotateX: 6 }
              : { y: 0, scale: 1, rotateX: 0 }
          }
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        >
          <PackFace art={art} size={packSize} year={year} />
        </motion.div>

        {/* The exposed fibre, revealed as the strip leaves it. */}
        <motion.div
          aria-hidden
          className="absolute inset-0"
          style={{ clipPath: coreClip(edge), background: "oklch(0.95 0.02 240)" }}
          initial={false}
          animate={{ opacity: sealed ? Math.min(travel * 0.5, 0.35) : 0.7 }}
          transition={{ duration: 0.3 }}
        />

        {/* The mouth: the dark of the open pack, spreading left to right behind
            the rip rather than appearing all at once. */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 h-12 -translate-y-1/2"
          style={{
            top: `${stripPct}%`,
            transformOrigin: "left center",
            background:
              "radial-gradient(ellipse at center, oklch(0 0 0 / 88%) 0%, transparent 72%)",
          }}
          initial={false}
          animate={{ scaleX: shed && !reduced ? 1 : 0, opacity: shed ? 1 : 0 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
        />

        {/* The seam, under tension.

            This used to be a single pass of light fired once the strip had already
            gone — a label on a rip that had happened. It is worth far more as the
            thing that happens *first*: the tear line lights up and thickens while
            the pack is still sealed, so the eye is looking at exactly the right
            twenty pixels when they come apart. */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -translate-y-1/2"
          style={{
            top: `${stripPct}%`,
            background:
              "linear-gradient(90deg, transparent, oklch(0.92 0.16 205 / 95%), transparent)",
          }}
          initial={false}
          animate={
            reduced
              ? { opacity: 0 }
              : seaming
                ? // Built, not flashed. It grows out from the middle of the seam
                  // and brightens, and it is still there when the strip lets go.
                  { opacity: [0, 0.9], scaleX: [0.25, 1], height: [1, 3] }
                : bracing
                  ? { opacity: 0, scaleX: 0.25, height: 1 }
                  : // Blown out by the rip it was announcing.
                    { opacity: [0.9, 0], scaleX: 1, height: 2 }
          }
          transition={{ duration: seaming ? 0.18 : 0.24, ease: "easeOut" }}
        />

        {/* Light escaping the pack.
            Clipped to the tear line itself, so it is genuinely coming out of the
            opening rather than being a bright rectangle laid over it. Screen
            blend, because this is light rather than paint. */}
        {!reduced && (
          <motion.div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{ clipPath: mouthClip(edge, 0), mixBlendMode: "screen" }}
            initial={false}
            animate={{ opacity: shed && !spilled ? [0, 1, 0] : 0 }}
            transition={{ duration: 0.25, times: [0, 0.36, 1], ease: "easeOut" }}
          >
            <div
              className="absolute inset-x-0"
              style={{
                top: `${stripPct - 14}%`,
                height: "42%",
                background:
                  "radial-gradient(60% 100% at 50% 100%, oklch(1 0 0 / 92%) 0%, oklch(0.88 0.13 205 / 62%) 38%, transparent 72%)",
              }}
            />
          </motion.div>
        )}

        {/* The torn strip, while a finger is still on it.

            Inside the clipped box only while sealed, which is what keeps the pack's
            rounded top corners. Half a rip lifts the left end by around 27px and
            most of a 15%-tall strip is still in frame, so the clipping costs
            nothing here — and the moment the rip commits it moves out. */}
        {sealed && (
          <div aria-hidden className="absolute inset-0" style={stripStyle}>
            <PackFace art={art} size={packSize} year={year} />
          </div>
        )}

        {/* The perforation, and the tab that says which end to start from. Hidden
            once the rip is under way — a dotted line across a tear you are already
            making is just a label over the thing it describes. */}
        {sealed && progress < 0.05 && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 flex items-center gap-2 px-3"
            style={{ top: `${stripPct}%`, transform: "translateY(-50%)" }}
          >
            <div className="tear-hint rounded-sm bg-primary/90 px-1.5 py-0.5 font-display text-[8px] font-black uppercase tracking-[0.2em] text-background">
              Rip
            </div>
            <div className="h-px flex-1 border-t border-dashed border-white/60" />
          </div>
        )}

        {/* The leading edge of the rip, so the eye has something to follow. It
            races to the far side once the rip commits — the gesture only ever
            takes it 60% of the way. */}
        {travel > 0.05 && !reduced && !shed && (
          <motion.div
            aria-hidden
            className="pointer-events-none absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/70 blur-md"
            style={{ top: `${stripPct}%` }}
            animate={{ left: `${(travel * 100).toFixed(1)}%`, opacity: sealed ? 1 : [1, 0] }}
            transition={{ duration: sealed && dragging ? 0 : 0.3, ease: "easeOut" }}
          />
        )}
      </motion.div>

      {/* The strip finishing the rip on its own, still one piece.

          Out here rather than in the box above, because a full rip rotates it 8°
          about its right edge and lifts the left end some 44px — clean off the top
          of the pack. Clipped, that read as the strip blinking out of existence
          rather than peeling. Its top corners are square out here, and for the
          300ms it is violently rotating away nobody has ever noticed.

          It animates from wherever the finger actually got to. A brand-new element
          has no transition to inherit from the one it replaced, so given a plain
          style it would paint at full travel on its very first frame — the last
          40% of the rip arriving as a jump. On the keyboard path `committedAt` is
          0 and this plays the whole rip, which is the only rip that path has. */}
      {!sealed && !shed && !reduced && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ clipPath: stripClip(edge), transformOrigin: "right center" }}
          initial={{ rotate: -committedAt.current * 8, y: -committedAt.current * 14 }}
          // Held exactly where the finger left it through the anticipation, then
          // released. The strip is the thing under tension during `seam`, so it
          // must not be quietly finishing its own rip while the seam is still
          // announcing one.
          animate={
            bracing
              ? { rotate: -committedAt.current * 8, y: -committedAt.current * 14 }
              : { rotate: -8, y: -14 }
          }
          // Plainer than the house easeOutQuint used everywhere else here, and
          // measured rather than guessed: quint is 91% travelled by 60ms, which to
          // an eye is the jump this exists to remove. Sized to `rip`, so the strip
          // is still travelling when the shards take over from it.
          transition={{ duration: 0.2, ease: "easeOut" }}
        >
          <PackFace art={art} size={packSize} year={year} />
        </motion.div>
      )}

      {/* What is coming out. Outside the clipped box so it can leave the pack, and
          cut by the tear line until it has — the clip is what makes a card read as
          coming *out of* the pack rather than as appearing over it. */}
      {children ? (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          initial={false}
          animate={{ clipPath: mouthClip(edge, spilled || reduced ? 1 : 0) }}
          transition={{ duration: 0.62, ease: [0.22, 1, 0.36, 1] }}
        >
          {/* Its own camera. The clip above is a grouping property, so it flattens
              this subtree out of the pack's 3D context and the perspective from
              further up never reaches the cards. */}
          <div className="absolute inset-0" style={{ perspective: "1000px" }}>
            {children}
          </div>
        </motion.div>
      ) : null}

      {/* The strip once it has let go: three pieces, each disagreeing with the
          others about where it is going. Rendered outside the clipped box so they
          can actually leave the pack. */}
      {shed &&
        !reduced &&
        SHARDS.map(([from, to], i) => {
          const f = SHARD_FLIGHT[i];
          return (
            <motion.div
              key={i}
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                clipPath: shardClip(edge, from, to),
                transformOrigin: "center",
                filter: "drop-shadow(0 8px 12px oklch(0 0 0 / 55%))",
                willChange: "transform, opacity",
              }}
              // Exactly where the strip was at full travel, so the swap from one
              // strip to three shards lands on a frame where nothing has moved.
              initial={{ x: 0, y: -14, rotateZ: -8, rotateX: 0, scale: 1, opacity: 1 }}
              animate={{
                x: f.x,
                y: f.y,
                // Overshoot on both rotation axes rather than a straight arc. That
                // overshoot is the entire difference between "flies off" and
                // "flutters".
                rotateZ: [-8, f.rz * 0.4, f.rz * 1.25, f.rz],
                rotateX: [0, f.rx * 0.7, f.rx * 1.3, f.rx],
                scale: 0.92,
                opacity: [1, 1, 0],
              }}
              transition={{
                duration: f.sec,
                delay: i * 0.04,
                ease: [0.16, 0.8, 0.34, 1],
                rotateZ: { times: [0, 0.3, 0.7, 1] },
                rotateX: { times: [0, 0.3, 0.7, 1] },
                opacity: { times: [0, 0.6, 1] },
              }}
            >
              <PackFace art={art} size={packSize} year={year} />
            </motion.div>
          );
        })}
    </div>
  );
}
