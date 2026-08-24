import { Flame } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Streak } from "@/lib/streaks";

/**
 * The running total of days somebody has shown up.
 *
 * Structurally the same block as the Collected counter it sits beside — a small
 * label over a big number — because the header row it lives in must not change
 * height when the pack tears. That row fades to nothing and goes inert for the
 * ceremony but deliberately keeps its space; anything here that reflowed mid-rip
 * would slide the pack on the one frame the tear is meant to be the only thing
 * moving.
 *
 * Its own test id, never `collected-count`: two nodes carrying that one on a
 * single screen is a trap the e2e suite would walk into.
 */
export function StreakFlame({ streak, className }: { streak: Streak; className?: string }) {
  // Nothing to say at zero, same rule as streakLine and packedByLabel. A streak
  // nobody has is not worth a third of a phone-width header row.
  if (streak.current === 0) return null;

  return (
    <div className={cn("text-center", className)} data-testid="streak-flame">
      <div className="font-display text-[10px] font-bold uppercase tracking-[0.3em] text-muted-foreground">
        Streak
      </div>
      <div className="flex items-center justify-center gap-1">
        <Flame
          aria-hidden
          className={cn("h-4 w-4", streak.openedToday && "streak-flame-pulse")}
          // The penalty amber, which is the only warm colour in a palette built
          // out of cyan. Inline rather than a class because the custom property
          // below has to travel with it for the pulse to have anything to glow.
          style={
            {
              color: "oklch(0.82 0.19 85)",
              "--flame-edge": "oklch(0.82 0.19 85 / 55%)",
            } as React.CSSProperties
          }
        />
        <span className="font-display text-lg font-black" style={{ color: "oklch(0.82 0.19 85)" }}>
          {streak.current}
        </span>
      </div>
    </div>
  );
}
