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

const MAX_EDGE_LARGE = 1600;
const MAX_EDGE_MEDIUM = 800;
const MAX_EDGE_THUMB = 320;
const QUALITY = 0.86;
/** Below this, re-encoding costs more in quality than it saves in bytes. */
const PASSTHROUGH_BYTES = 400_000;

export type EncodedImageSizes = {
  thumb: string;
  medium: string;
  large: string;
};

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

function encodeCanvas(canvas: HTMLCanvasElement): string {
  const type = encodesWebp(canvas) ? "image/webp" : "image/jpeg";
  return canvas.toDataURL(type, QUALITY);
}

function resizeCanvas(source: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create canvas context");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * Returns three data URLs for a single image: thumb, medium, and large. The
 * browser canvas is used, so this never needs server-side image libraries.
 *
 * The original file is passed through unchanged (for all three slots) when it
 * is already small, so a designer-optimised asset does not take a second generation
 * hit.
 */
export async function encodeUploadImageVariants(file: File): Promise<EncodedImageSizes> {
  try {
    const source = await loadImage(file);
    const w = "naturalWidth" in source ? source.naturalWidth : source.width;
    const h = "naturalHeight" in source ? source.naturalHeight : source.height;
    if (!w || !h) {
      const passthrough = await readAsDataUrl(file);
      return { thumb: passthrough, medium: passthrough, large: passthrough };
    }

    const maxEdge = Math.max(w, h);
    const scaleLarge = Math.min(1, MAX_EDGE_LARGE / maxEdge);
    const scaleMedium = Math.min(1, MAX_EDGE_MEDIUM / maxEdge);
    const scaleThumb = Math.min(1, MAX_EDGE_THUMB / maxEdge);

    if (scaleLarge === 1 && file.size <= PASSTHROUGH_BYTES) {
      const passthrough = await readAsDataUrl(file);
      if ("close" in source) source.close();
      return { thumb: passthrough, medium: passthrough, large: passthrough };
    }

    const large =
      scaleLarge < 1
        ? encodeCanvas(resizeCanvas(source as CanvasImageSource, w * scaleLarge, h * scaleLarge))
        : await readAsDataUrl(file);

    const medium =
      scaleMedium < 1
        ? encodeCanvas(resizeCanvas(source as CanvasImageSource, w * scaleMedium, h * scaleMedium))
        : large;

    const thumb =
      scaleThumb < 1
        ? encodeCanvas(resizeCanvas(source as CanvasImageSource, w * scaleThumb, h * scaleThumb))
        : medium;

    if ("close" in source) source.close();

    return {
      thumb: thumb.startsWith("data:image/") ? thumb : large,
      medium: medium.startsWith("data:image/") ? medium : large,
      large: large.startsWith("data:image/") ? large : await readAsDataUrl(file),
    };
  } catch {
    // Last resort. If even a plain read fails the handle is gone, so say
    // something a human can act on rather than the browser's permission prose.
    try {
      const passthrough = await readAsDataUrl(file);
      return { thumb: passthrough, medium: passthrough, large: passthrough };
    } catch {
      throw new Error(`Couldn't read ${file.name} — pick it again, or save it to your phone first`);
    }
  }
}

/**
 * Single-size variant kept for call sites that do not need responsive sizes
 * (for example, secret card art that is always shown at one resolution).
 */
export async function encodeUploadImage(file: File): Promise<string> {
  const sizes = await encodeUploadImageVariants(file);
  return sizes.large;
}

/**
 * Copy a picked file's bytes into memory, immediately.
 *
 * On Android a file chosen from Gallery / Photos / Drive is a handle to a
 * document the OS can revoke at any time. The upload panels stage a file, show
 * a preview, and only read the bytes when the admin taps save — by which point
 * the handle is often dead and both `createImageBitmap` and `FileReader` fail
 * with a raw `NotReadableError` ("The requested file could not be read…").
 * Snapshotting at pick time means the handle no longer matters afterwards.
 */
export async function snapshotFile(file: File): Promise<File> {
  try {
    const buf = await file.arrayBuffer();
    return new File([buf], file.name, {
      type: file.type,
      lastModified: file.lastModified,
    });
  } catch {
    throw new Error(`Couldn't read ${file.name} — pick it again, or save it to your phone first`);
  }
}
