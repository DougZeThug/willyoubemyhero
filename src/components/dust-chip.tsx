import { Link } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * What you have, as a tappable pill.
 *
 * Renders nothing at all until the balance is known, rather than a zero. A "0"
 * that turns into "140" a frame later reads as having just lost something, and
 * the vault already has three counters that wait for their real number for the
 * same reason.
 *
 * Zero itself IS shown once it is known — a member with no dust needs to see the
 * thing exists before they can want any.
 */
export function DustChip({
  balance,
  to,
  className,
}: {
  balance: number | undefined;
  /**
   * Where tapping it goes. Omitted, the chip is a plain read-out.
   *
   * A Link rather than the button-and-callback this used to take: the shop is a
   * screen now, and a button that navigates gives up middle-click, long-press
   * and "open in new tab" for nothing.
   */
  to?: string;
  className?: string;
}) {
  if (balance == null) return null;
  const label = `${balance.toLocaleString()} dust`;
  const body = (
    <>
      <Sparkles className="h-3.5 w-3.5" aria-hidden />
      <span className="font-display text-xs font-bold uppercase tracking-[0.15em]">{label}</span>
    </>
  );
  const base =
    "inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-primary";

  if (!to) {
    return (
      <span className={cn(base, className)} aria-label={label}>
        {body}
      </span>
    );
  }
  return (
    <Link
      to={to}
      aria-label={`${label} — open the dust shop`}
      className={cn(
        base,
        // A real 44px target: this sits next to a heading in a garden, held in
        // one hand, and the pill itself is only 28px tall.
        "min-h-11 transition-colors hover:bg-primary/20 active:bg-primary/25",
        className,
      )}
    >
      {body}
    </Link>
  );
}
