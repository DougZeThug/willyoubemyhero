// Image URL shapes, and the pure helpers that read them.
//
// Split out of media.functions.ts, which is where the *server* side of images
// lives: signing, uploading, decoding data URLs, the storage bucket. That module
// imports `require-auth.server` at the top, and while the tanstackStart transform
// does strip it — handler bodies become opaque RPC ids, so nothing references the
// guard and it tree-shakes — a client component reaching across that line and
// relying on a bundler pass to undo it is a bad boundary to have. Half the
// components in the app want `urlFromSet` and none of them want any of the rest.
//
// Everything here is plain data and arithmetic. No I/O, no imports, safe in a
// browser, on a server, and in a test with neither.

/**
 * Widths the storage renderer resizes to. The originals are ~3 MB PNGs and a
 * phone grid asks for a dozen at once, which is what left tiles showing their
 * alt text. Signing with a transform hands back a WebP a fraction of the size
 * and needs no re-upload, so it also covers every image whose variant columns
 * were never backfilled.
 *
 * `large` is deliberately 1200 and not 1600: a 1600px resize of a 3.1 MB PNG
 * measured 3.1 MB, i.e. no saving at all, and the browser picks the widest
 * srcset entry on a 3x phone screen — which is what stalled the grid.
 */
export const VARIANT_WIDTHS = { thumb: 320, medium: 800, large: 1200 } as const;

export type ImageUrlSet = {
  thumb: string | null;
  medium: string | null;
  large: string | null;
};

export type SizedPhotoUrls = Record<string, ImageUrlSet>;

export type CardUrls = {
  front: ImageUrlSet | null;
  back: ImageUrlSet | null;
};

/** Which face of a player's card an upload is for. */
export type CardSide = "front" | "back";

export function urlFromSet(
  set: ImageUrlSet | string | null | undefined,
  size: keyof ImageUrlSet = "large",
): string | null {
  if (!set) return null;
  if (typeof set === "string") return set;
  return set[size] ?? set.large ?? set.medium ?? set.thumb;
}

export function srcSetFromSet(
  set: ImageUrlSet | string | null | undefined,
  /**
   * Grid tiles never render wider than ~220 CSS px, so offering the widest
   * entry there just invites a phone with a 3x screen to download it.
   */
  max: keyof ImageUrlSet = "large",
): string | undefined {
  if (!set || typeof set === "string") return undefined;
  const parts: string[] = [];
  if (set.thumb) parts.push(`${set.thumb} ${VARIANT_WIDTHS.thumb}w`);
  if (max !== "thumb" && set.medium) parts.push(`${set.medium} ${VARIANT_WIDTHS.medium}w`);
  if (max === "large" && set.large) parts.push(`${set.large} ${VARIANT_WIDTHS.large}w`);
  return parts.length ? parts.join(", ") : undefined;
}
