import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Pin one card to the top of the vault.
 *
 * It sits over a card that is itself a link or a tap target, so it stops the
 * event dead rather than relying on where it happens to be mounted. The roster
 * tile wraps its whole body in a <Link>, and a star that navigated to the player
 * page every time somebody pinned a card would be the entire feature broken.
 *
 * aria-pressed rather than two different buttons, so a screen reader announces
 * the state change on the control the user just operated instead of it silently
 * becoming a different control.
 */
export function FavouriteButton({
  name,
  on,
  onToggle,
  className,
}: {
  /** The card's name, so the label says which card this pins. */
  name: string;
  on: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? `Unpin ${name} from the top` : `Pin ${name} to the top`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      className={cn(
        "flex h-9 w-9 items-center justify-center rounded-full border backdrop-blur transition-colors",
        on
          ? "border-primary/60 bg-background/80 text-primary"
          : // Dimmed rather than hidden-until-hover: hover does not exist on the
            // phone this is played on, and a control you cannot find is not one.
            "border-white/15 bg-background/60 text-muted-foreground hover:border-primary/50 hover:text-primary",
        className,
      )}
    >
      <Star className="h-4 w-4" fill={on ? "currentColor" : "none"} aria-hidden />
    </button>
  );
}
