import { useElapsed } from "@/hooks/use-elapsed";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export function BigTimer({
  runningSinceMs,
  paused,
  className,
}: {
  /** Elapsed ms already accumulated at anchor (frozen when paused) */
  runningSinceMs: number;
  paused: boolean;
  className?: string;
}) {
  const ms = useElapsed(runningSinceMs, paused);

  return (
    <div
      className={cn(
        "timer-digits text-[4.75rem] leading-none sm:text-[6.5rem]",
        paused ? "text-warn" : "text-primary",
        className,
      )}
    >
      {formatTime(ms)}
    </div>
  );
}
