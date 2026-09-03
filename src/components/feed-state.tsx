// Shared pending / failed / stale vocabulary for the spectator screens.
//
// Every one of them used to render its empty state for all three cases, so a
// fetch that had not returned yet, a fetch that had failed, and a combine
// nobody had started looked identical. On a phone in a garden the middle one is
// the common case, and it is the one worth saying out loud.
import { RefreshCw, WifiOff } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function FeedLoading({
  label = "Reading the combine…",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <Card className={cn("hud-bezel border-primary/20", className)}>
      <CardContent className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
        <RefreshCw className="h-4 w-4 animate-spin text-primary/70" />
        {label}
      </CardContent>
    </Card>
  );
}

export function FeedError({
  message,
  onRetry,
  className,
}: {
  message?: string | null;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <Card className={cn("hud-bezel border-warn/50", className)}>
      <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
        <WifiOff className="h-6 w-6 text-warn" />
        <div>
          <p className="font-display text-sm font-black uppercase tracking-widest text-warn">
            Can&apos;t reach the combine
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {message ?? "The connection dropped. Nothing is lost — this screen is read-only."}
          </p>
        </div>
        {onRetry && (
          <Button size="default" variant="secondary" className="min-h-11" onClick={onRetry}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Try again
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Live updates are down but polling is still running, so this is a caveat
 * rather than an error: the numbers are real, just a few seconds behind.
 */
export function FeedDegradedBanner({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex items-center justify-center gap-2 rounded-md border border-warn/30 bg-warn/10 px-3 py-1.5 text-meta font-semibold text-warn",
        className,
      )}
    >
      <WifiOff className="h-3.5 w-3.5" />
      Live feed down — refreshing every few seconds
    </div>
  );
}
