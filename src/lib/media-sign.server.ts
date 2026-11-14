// Signing storage paths into short-lived URLs, with a process-wide cache so a
// roster of photos is not re-signed on every request. Split from the handlers in
// media.functions.ts so other server modules can sign a path without importing
// the upload and archive endpoints.
import type { ImageUrlSet } from "./media";
import { VARIANT_WIDTHS } from "./media";

const SIGNED_TTL_S = 8 * 60 * 60;
/** Re-sign well before expiry so a URL handed out now stays valid for hours. */
const SIGNED_REUSE_MS = 6 * 60 * 60_000;
/** Bounded so a long-lived server process can't accumulate every event ever. */
const SIGNED_CACHE_MAX = 600;

const signedCache = new Map<string, { url: string; mintedAt: number }>();
const signingNow = new Map<string, Promise<string | null>>();

/** Lower quality where the image is small enough that nobody can tell. */
const QUALITY_FOR_WIDTH: Record<number, number> = {
  [320]: 58,
  [800]: 68,
  [1200]: 74,
};

function cacheKey(path: string, width?: number) {
  return width ? `${path}@${width}` : path;
}

async function mintSignedUrl(path: string, width?: number): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const key = cacheKey(path, width);
  const { data: signed } = await supabaseAdmin.storage.from("participant-photos").createSignedUrl(
    path,
    SIGNED_TTL_S,
    width
      ? {
          transform: {
            width,
            quality: QUALITY_FOR_WIDTH[width] ?? 72,
            resize: "contain",
          },
        }
      : undefined,
  );
  if (!signed?.signedUrl) return null;
  if (signedCache.size >= SIGNED_CACHE_MAX) {
    const oldest = signedCache.keys().next().value;
    if (oldest) signedCache.delete(oldest);
  }
  signedCache.delete(key);
  signedCache.set(key, { url: signed.signedUrl, mintedAt: Date.now() });
  return signed.signedUrl;
}

export async function signPath(path: string | null, width?: number): Promise<string | null> {
  if (!path) return null;
  const key = cacheKey(path, width);
  const hit = signedCache.get(key);
  if (hit && Date.now() - hit.mintedAt < SIGNED_REUSE_MS) return hit.url;
  const pending = signingNow.get(key);
  if (pending) return pending;
  const p = mintSignedUrl(path, width).finally(() => signingNow.delete(key));
  signingNow.set(key, p);
  return p;
}

export function forgetSignedPath(path: string | null | undefined) {
  if (!path) return;
  signedCache.delete(path);
  for (const w of Object.values(VARIANT_WIDTHS)) signedCache.delete(cacheKey(path, w));
}

export async function signSet(paths: {
  thumb: string | null;
  medium: string | null;
  large: string | null;
}): Promise<ImageUrlSet> {
  // A missing variant path is the common case — nothing was ever backfilled —
  // so fall back to a resize of the original rather than to the original itself.
  const [thumb, medium, large] = await Promise.all([
    paths.thumb ? signPath(paths.thumb) : signPath(paths.large, VARIANT_WIDTHS.thumb),
    paths.medium ? signPath(paths.medium) : signPath(paths.large, VARIANT_WIDTHS.medium),
    // With no variants the stored file is the untouched original — the
    // multi-megabyte PNG — so it is never handed back as is. With them, it is the
    // encoder's own output: at most 1600px, and re-encoded unless it was already
    // under the passthrough budget (image-encode.ts), so a second transform here
    // would only cost a generation of quality.
    paths.medium ? signPath(paths.large) : signPath(paths.large, VARIANT_WIDTHS.large),
  ]);
  return { thumb, medium, large };
}
