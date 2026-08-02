// Getting card art into the browser cache before it is needed.
//
// The reveal sequence shows one card at a time, and a flip that lands on a blank
// frame while the image is still fetching is the one failure the whole ceremony
// cannot survive. Nothing else in the app preloads: the vault grid can afford to
// stream in, because nothing there is a surprise.

import { srcSetFromSet, urlFromSet } from "@/lib/media";
import type { ImageUrlSet } from "@/lib/media";
import { CARD_SIZES } from "@/components/holo-card";

/**
 * Fetch and decode a card's art, resolving once it is ready to paint.
 *
 * Takes the whole `ImageUrlSet` rather than one url on purpose. Card art is
 * served at three widths and HoloCard hands all of them to the browser as a
 * `srcSet`, so which one it actually renders depends on the viewport and the
 * device pixel ratio — a DPR-2 phone picks the 800w image, a DPR-3 phone the
 * 1600w. Warming a single hard-coded size therefore missed on half the devices
 * in the league: it fetched an image the card would never render, and the one it
 * did render still arrived during the flip.
 *
 * Setting `srcset` and the *same* `sizes` string the card uses runs the
 * browser's own selection algorithm, so this warms exactly the candidate that
 * will be requested.
 *
 * Never rejects. A preload is an optimisation, and a card that failed to warm is
 * still a card the user is entitled to turn over — awaiting this must not be
 * able to strand the sequence.
 */
export async function preloadCard(set: ImageUrlSet | string | null | undefined): Promise<void> {
  if (!set || typeof window === "undefined") return;
  const src = urlFromSet(set);
  if (!src) return;
  try {
    const img = new Image();
    // Do not opt private signed URLs into CORS mode. The card is never drawn to
    // a canvas, and requiring CORS here can turn an otherwise valid image into a
    // browser-level load failure when object and transform endpoints differ.
    img.decoding = "async";
    const srcSet = srcSetFromSet(set);
    if (srcSet) {
      img.sizes = CARD_SIZES;
      img.srcset = srcSet;
    }
    img.src = src;
    await img.decode();
  } catch {
    /* a cold card still turns over */
  }
}
