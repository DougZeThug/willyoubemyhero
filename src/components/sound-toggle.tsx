import { Volume2, VolumeX } from "lucide-react";
import { useCardSfx } from "@/lib/card-sfx";
import { cn } from "@/lib/utils";

/**
 * The switch that stops the noise.
 *
 * Lifted out of the pack route's header row, which was the wrong place for it in
 * a way that only showed up mid-ceremony: that row fades to zero and goes `inert`
 * the moment the tear commits, so the control disappeared exactly when somebody
 * would reach for it. It is one component now so the pack can put the same
 * button in the same corner on the sealed screen, the stand and the summary.
 *
 * DELIBERATELY NOT `role="button"`. A native button already has that role, and
 * the e2e suite finds the card on the reveal stand with
 * `[role="button"][aria-pressed]` — a CSS attribute selector, which an implicit
 * role does not satisfy. Writing the role out here would make this button the
 * first match and point the whole pack suite at the mute switch.
 */
export function SoundToggle({ className }: { className?: string }) {
  const sfx = useCardSfx();
  return (
    <button
      type="button"
      onClick={sfx.toggle}
      aria-pressed={!sfx.muted}
      aria-label={sfx.muted ? "Turn sound on" : "Turn sound off"}
      className={cn(
        "flex h-11 w-11 items-center justify-center text-muted-foreground transition-colors hover:text-primary",
        className,
      )}
    >
      {sfx.muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
    </button>
  );
}
