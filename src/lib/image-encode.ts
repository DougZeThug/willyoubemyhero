/**
 * Downscale and re-encode an image in the browser before it is uploaded.
 *
 * Card art arrives as whatever the designer exported — 4000px, 8 MB PNGs are
 * normal — and it was being stored and served at exactly that size. A phone
 * pulling thirty of those into the vault grid is the single biggest reason cards
 * paint in slowly, and no amount of caching fixes bytes that never needed to be
 * sent. A card is drawn at ~380 CSS px at its largest, so 1600px on the long
 * edge is still comfortably retina.
 *
 * Anything already small enough is passed through untouched rather than being
 * re-encoded, so an already-optimised file never takes a second generation loss.
 */

const MAX_EDGE = 1600;
const QUALITY = 0.86;
/** Below this, re-encoding costs more in quality than it saves in bytes. */
const PASSTHROUGH_BYTES = 400_000;

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error ?? new Error("Could not read file"));
    r.readAsDataURL(file);
  });
}

async function loadImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      /* Safari refuses some formats here; fall back to an <img>. */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not decode image"));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function encodesWebp(canvas: HTMLCanvasElement) {
  return canvas.toDataURL("image/webp").startsWith("data:image/webp");
}

/**
 * Returns a data URL suitable for the upload server functions: the original when
 * the file is already lean, a downscaled WebP (or JPEG where WebP is unavailable)
 * otherwise. Never throws for image reasons — an undecodable file falls back to
 * the raw data URL so the upload path behaves exactly as it did before.
 */
export async function encodeUploadImage(file: File): Promise<string> {
  try {
    const source = await loadImage(file);
    const w = "naturalWidth" in source ? source.naturalWidth : source.width;
    const h = "naturalHeight" in source ? source.naturalHeight : source.height;
    if (!w || !h) return await readAsDataUrl(file);

    const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
    if (scale === 1 && file.size <= PASSTHROUGH_BYTES) return await readAsDataUrl(file);

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return await readAsDataUrl(file);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source as CanvasImageSource, 0, 0, canvas.width, canvas.height);
    if ("close" in source) source.close();

    // WebP keeps the alpha channel that some card art relies on for its corners;
    // JPEG would flatten it to black, so it is only the fallback.
    const type = encodesWebp(canvas) ? "image/webp" : "image/jpeg";
    const out = canvas.toDataURL(type, QUALITY);
    if (!out.startsWith("data:image/")) return await readAsDataUrl(file);
    if (scale < 1) return out;
    // Nothing was resized, so this re-encode only pays off if it actually shrank
    // the file — an already-optimised JPEG usually comes out bigger.
    const original = await readAsDataUrl(file);
    return out.length < original.length ? out : original;
  } catch {
    return await readAsDataUrl(file);
  }
}
