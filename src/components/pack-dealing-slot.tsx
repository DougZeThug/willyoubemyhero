import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { PackageOpen } from "lucide-react";

/** How long the dealing slot stays wordless before it says the signal is slow. */
const SLOW_SIGNAL_MS = 3_000;

/**
 * Words for the dealing slot once it has been bare too long.
 *
 * Mounted only while the slot is, so its clock starts with the wait and a retry
 * (which swaps the slot out for the retry card and back) starts it over. It
 * never touches the request or its timeout: it only says the wait is not a
 * lost pack.
 */
function SlowSignal() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), SLOW_SIGNAL_MS);
    return () => clearTimeout(t);
  }, []);
  if (!slow) return null;
  return (
    <p role="status" className="px-4 text-center text-meta font-semibold text-muted-foreground">
      Slow signal — it&apos;s yours either way
    </p>
  );
}

/**
 * The wrapper is off and the cards are still on their way — or the server could
 * not deal any. Never a toast: a toast announces the pack to whoever is glancing
 * at the phone over your shoulder.
 */
export function PackDealingSlot({
  state,
  onRetry,
}: {
  state: "idle" | "pending" | "failed" | "unavailable";
  onRetry: () => void;
}) {
  return (
    <div className="mx-auto flex max-w-[320px] flex-col items-center gap-3 py-6 text-center">
      {state === "failed" ? (
        <button
          type="button"
          onClick={onRetry}
          data-testid="pack-retry"
          // Not dimmed: it is the only way out of this state, read outdoors.
          className="wax-foil flex aspect-[5/7] w-full flex-col items-center justify-center gap-2 rounded-xl border border-white/15 p-4 text-center"
        >
          <span className="font-display text-badge font-black uppercase tracking-[0.08em]">
            No signal
          </span>
          <span className="text-meta leading-snug text-muted-foreground">
            Tap to try again — today&apos;s pack is still yours.
          </span>
        </button>
      ) : state === "unavailable" ? (
        <>
          <div className="wax-foil flex aspect-[5/7] w-full items-center justify-center rounded-xl border border-white/15 opacity-60">
            <span className="font-display text-badge font-black uppercase tracking-[0.08em]">
              Nothing to deal today
            </span>
          </div>
          <Link to="/players" className="neon-btn-lg neon-btn-hero w-full">
            <PackageOpen className="h-4 w-4" />
            View collection
          </Link>
        </>
      ) : (
        // The same sealed-back sweep the old fourth slot showed while its
        // pull was in the air.
        <div
          data-testid="pack-dealing"
          className="wax-foil pack-seal-wait relative flex aspect-[5/7] w-full items-center justify-center overflow-hidden rounded-xl border border-white/15"
        >
          <SlowSignal />
        </div>
      )}
    </div>
  );
}
