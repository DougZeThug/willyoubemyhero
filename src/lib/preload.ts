// Getting card art into the browser cache before it is needed.
//
// The reveal sequence shows one card at a time, and a flip that lands on a blank
// frame while the image is still fetching is the one failure the whole ceremony
// cannot survive. Nothing else in the app preloads: the vault grid can afford to
// stream in, because nothing there is a surprise.

/**
 * Fetch and decode an image, resolving once it is ready to paint.
 *
 * Never rejects. A preload is an optimisation, and a card that failed to warm is
 * still a card the user is entitled to turn over — awaiting this must not be able
 * to strand the sequence.
 */
export async function preloadImage(url: string | null | undefined): Promise<void> {
  if (!url || typeof window === "undefined") return;
  try {
    const img = new Image();
    // Card art is served from a private bucket as signed URLs, and HoloCard
    // renders it with crossOrigin="anonymous". Matching that here is what makes
    // the two requests share a cache entry rather than fetch twice.
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.src = url;
    await img.decode();
  } catch {
    /* a cold card still turns over */
  }
}
