import type { ComponentProps } from "react";
import { offlineReason } from "@/hooks/use-online";
import { cn } from "@/lib/utils";

const PILL =
  "inline-flex min-h-11 w-full items-center justify-center rounded-full border px-6 text-label font-bold uppercase tracking-[0.08em] transition-colors";

const TONE = {
  /** The one answer the screen is asking for. */
  primary: "neon-btn-lg neon-btn-hero w-full disabled:opacity-50",
  /** Turning an offer down. */
  decline: cn(
    PILL,
    "border-border-strong text-muted-foreground hover:border-destructive hover:text-destructive disabled:opacity-50",
  ),
  /** Taking back something you put out. */
  retract: cn(PILL, "border-primary/40 text-primary hover:bg-primary/10 disabled:opacity-50"),
  /** Backing out of a question without answering it. */
  dismiss: cn(PILL, "border-border-strong text-muted-foreground hover:text-foreground"),
} as const;

/**
 * The pill buttons on the trade screens. An action that needs the network goes
 * quiet and says why when offline, rather than throwing a toast on tap, so
 * `offline` is part of the button instead of something each caller remembers.
 *
 * `inline` lets it shrink to its text from the `sm` breakpoint, for the buttons
 * that sit on an offer card rather than in a full-width sheet.
 */
export function OfferButton({
  tone,
  inline,
  offline = false,
  disabled,
  className,
  ...button
}: {
  tone: keyof typeof TONE;
  inline?: boolean;
  offline?: boolean;
} & ComponentProps<"button">) {
  return (
    <button
      type="button"
      {...button}
      disabled={disabled || offline}
      {...offlineReason(offline)}
      className={cn(TONE[tone], inline && "sm:w-auto", className)}
    />
  );
}
