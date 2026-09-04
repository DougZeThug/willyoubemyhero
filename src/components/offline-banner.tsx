import { WifiOff } from "lucide-react";
import { OFFLINE_MESSAGE } from "@/hooks/use-online";

/**
 * The slim strip that says why half the buttons have gone quiet.
 *
 * Bottom rather than top, and above the tab bar rather than over it: this is the
 * one piece of chrome that has to be seen while a thumb is already down at the
 * bottom of the screen, and the bar itself is what a phone user is looking at.
 * `--above-tab-bar` is the shared floor — see the note on it in styles.css — so
 * it lands in the same slot the toaster starts from and moves with it if the bar
 * ever changes height.
 *
 * `role="status"` rather than `alert`: losing signal is a condition, not an
 * interruption, and a polite live region announces it once without cutting off
 * whatever was being read.
 *
 * Rendered by the app shell, so it is the same strip on every screen — and
 * suppressed while a ceremony owns the device, for the same reason the toaster
 * is. Nothing about being offline is worth landing on top of a card reveal.
 */
export function OfflineBanner() {
  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-0 bottom-[var(--above-tab-bar)] z-40 flex justify-center px-4"
    >
      <div className="flex max-w-md items-center gap-2 rounded-full border border-warn/40 bg-background/95 px-3 py-1.5 text-meta font-semibold leading-snug text-warn shadow-lg backdrop-blur">
        <WifiOff aria-hidden className="h-3.5 w-3.5 shrink-0" />
        {OFFLINE_MESSAGE}
      </div>
    </div>
  );
}
