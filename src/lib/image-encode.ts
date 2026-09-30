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
 * Anything already small enough — in pixels AND in bytes — is passed through
 * untouched rather than being re-encoded, so an already-optimised file never
 * takes a second generation loss.
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

/**
 * Types that carry no information — what a browser reports when it could not
 * work out what the file is, rather than a claim about it.
 */
const GENERIC_TYPES: ReadonlySet<string> = new Set([
  "",
  "application/octet-stream",
  "binary/octet-stream",
]);

/** The extensions the three upload gates admit by name when the browser gives no type. */
const EXTENSION_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

/**
 * A file's image type, repaired from its extension when the browser gave none.
 *
 * Several browsers report an empty MIME for a DRAGGED file, which the upload
 * gates already know — card-bulk-upload, universal-card-back and
 * secret-cards-panel all admit one by extension rather than silently dropping
 * it. What none of them did was carry that decision any further: FileReader
 * writes the blob's type into the data URL prefix, and an empty type writes no
 * image type there at all, so decodeImageDataUrl on the server refused the
 * result as "Unsupported image format". A card dragged in failed; the same card
 * picked from the file dialog worked, because a dialog filtered on `accept`
 * cannot produce an empty type.
 *
 * THE EXTENSION, NOT THE BYTES. It is the same claim the gate upstream admitted
 * the file on, so this label can never say something that gate would have
 * refused. Sniffing would mean a second read of a handle that may already be
 * dead, which is the whole reason snapshotFile exists, and could only ever
 * narrow to these same four names.
 *
 * ONLY when the browser said nothing useful. A type it actually reported wins,
 * even one the server will refuse: a gif named card.png clears the upload gate
 * on its name, and relabelling it image/png would walk gif bytes past the
 * server's format check and store them as a png. The refusal is the better
 * answer, and repairing only the generic types keeps it.
 */
export function imageTypeOf(file: File): string {
  if (!GENERIC_TYPES.has(file.type)) return file.type;
  return EXTENSION_TYPES[file.name.split(".").pop()?.toLowerCase() ?? ""] ?? file.type;
}

/**
 * The same file, relabelled. Wrapping a Blob does not read it — the new File
 * references the same data and never touches the OS handle — so this is safe on
 * the Android handle snapshotFile exists to defeat. It is a label, not a copy.
 */
function withImageType(file: File): File {
  const type = imageTypeOf(file);
  if (type === file.type) return file;
  return new File([file], file.name, { type, lastModified: file.lastModified });
}

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
 * hit. Anything else never comes back as the original in any slot: signSet serves
 * `large` untransformed whenever a medium variant is stored, on the strength of
 * exactly that.
 */
export async function encodeUploadImageVariants(input: File): Promise<EncodedImageSizes> {
  // Every passthrough below forwards the original bytes, and the server reads the
  // type off the data URL prefix — so the type has to be settled before the first
  // read, including the one in the catch.
  const file = withImageType(input);
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

    // Always re-encoded from here. Past the passthrough above, a file that needs
    // no shrinking is by definition over the byte budget — an 1100px PNG at
    // 2 MB — and storing it untouched shipped those bytes to every phone that
    // drew the large slot. The fallback at the bottom still covers a canvas that
    // cannot encode.
    const large = encodeCanvas(
      resizeCanvas(source as CanvasImageSource, w * scaleLarge, h * scaleLarge),
    );

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
      // Repaired here too, so the staged copy that feeds the preview and the
      // encoder carries a type the server will accept.
      type: imageTypeOf(file),
      lastModified: file.lastModified,
    });
  } catch {
    throw new Error(`Couldn't read ${file.name} — pick it again, or save it to your phone first`);
  }
}
