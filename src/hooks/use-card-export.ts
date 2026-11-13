import { errorMessage } from "@/lib/errors";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { exportCardPng, waitForPaint } from "@/lib/share-card";

/**
 * Rasterise the offscreen share card behind `ref` to a PNG download.
 *
 * `prepare` runs first and is where a screen makes the card ready: refetching
 * the signed art it draws, or waiting the frame it takes to mount. Anything that
 * goes wrong, including a card that never mounted, becomes a toast — a share
 * that fails silently leaves a screen reader user with nothing at all.
 */
export function useCardExport<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);
  const [busy, setBusy] = useState(false);

  async function exportCard(
    filename: string,
    { fallback, prepare }: { fallback: string; prepare?: () => Promise<unknown> },
  ) {
    setBusy(true);
    try {
      await prepare?.();
      const node = ref.current;
      if (!node) throw new Error("Share card not ready");
      // Waited on rather than guessed at: a fixed delay is either too long on
      // wifi or too short on a phone in a garden, and too short means a shared
      // card showing initials where a face should be.
      await waitForPaint(node);
      await exportCardPng(node, filename);
    } catch (e) {
      toast.error(errorMessage(e, fallback));
    } finally {
      setBusy(false);
    }
  }

  return { ref, busy, exportCard };
}
