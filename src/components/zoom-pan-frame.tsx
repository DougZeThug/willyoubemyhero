import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, Minus, Plus, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCardZoom } from "@/hooks/use-card-zoom";
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";

/**
 * The magnifier a single full-size card sits in.
 *
 * A card on a phone is the size of a card on a phone, and the back of one is a
 * stat block set in 9px type. This wraps the card rather than living inside it:
 * HoloCard's job is the tilt and the foil, and the two gesture models would fight
 * each other in one component. At 1x the frame stays out of the way entirely
 * except for reading the gesture; above 1x it owns the pointer and the card's own
 * tilt is switched off by the caller.
 *
 * Taps are handled here too, not by the card. Otherwise the first half of a
 * double tap would flip the card on its way to zooming in.
 */
export function ZoomPanFrame({
  children,
  onSwipe,
  onTap,
  canNavigate = false,
  prevLabel,
  nextLabel,
  position,
  hint,
  className,
}: {
  /** Rendered with the live zoom, so the card can drop its tilt while magnified. */
  children: (state: { zoom: number; zoomed: boolean }) => ReactNode;
  onSwipe?: (dir: -1 | 1) => void;
  onTap?: () => void;
  canNavigate?: boolean;
  prevLabel?: string;
  nextLabel?: string;
  /** e.g. "3 / 11". Shown between the arrows. */
  position?: string;
  hint?: string;
  className?: string;
}) {
  const reduced = usePrefersReducedMotion();
  const zoomer = useCardZoom({ onSwipe, onTap });
  const { zoom, zoomed } = zoomer;

  return (
    <div className={className}>
      <div
        ref={zoomer.frameRef}
        {...zoomer.handlers}
        className="relative overflow-hidden rounded-xl"
        // Claimed outright: a pinch that the browser turns into a page zoom is
        // gone for good, and touch-action is read once at gesture start.
        style={{ touchAction: "none" }}
      >
        <div
          ref={zoomer.contentRef}
          className={cn(!reduced && !zoomed && "transition-transform duration-200 ease-out")}
          style={{ transformOrigin: "0 0", willChange: "transform" }}
        >
          {children({ zoom, zoomed })}
        </div>
      </div>

      <div className="mt-2 flex items-center justify-center gap-1.5">
        {canNavigate && (
          <FrameButton label={prevLabel ?? "Previous card"} onClick={() => onSwipe?.(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </FrameButton>
        )}
        <FrameButton label="Zoom out" onClick={() => zoomer.zoomBy(1 / 1.5)} disabled={!zoomed}>
          <Minus className="h-4 w-4" />
        </FrameButton>
        {zoomed ? (
          <FrameButton label="Reset zoom" onClick={zoomer.reset}>
            <RotateCcw className="h-4 w-4" />
          </FrameButton>
        ) : (
          position && (
            <span className="min-w-14 text-center text-[10px] font-bold uppercase tracking-[0.25em] text-muted-foreground">
              {position}
            </span>
          )
        )}
        <FrameButton
          label="Zoom in"
          onClick={() => zoomer.zoomBy(1.5)}
          disabled={!zoomer.canZoomIn}
        >
          <Plus className="h-4 w-4" />
        </FrameButton>
        {canNavigate && (
          <FrameButton label={nextLabel ?? "Next card"} onClick={() => onSwipe?.(1)}>
            <ChevronRight className="h-4 w-4" />
          </FrameButton>
        )}
      </div>

      {hint && !zoomed && (
        <p className="mt-1 text-center text-[10px] font-bold uppercase tracking-[0.25em] text-muted-foreground/70">
          {hint}
        </p>
      )}
    </div>
  );
}

function FrameButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/10 bg-background/70 text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary disabled:opacity-30"
    >
      {children}
    </button>
  );
}