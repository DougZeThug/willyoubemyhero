/**
 * Matches the per-card cap in secret-cards.functions.ts and media.functions.ts
 * (12M base64 chars ≈ 8.8 MB raw). The server is the real wall; this is the
 * check that spares a phone encoding a file the server would refuse.
 */
export const MAX_IMAGE_BYTES = 8_800_000;
export const MAX_IMAGE_MB = Math.round(MAX_IMAGE_BYTES / 100_000) / 10;

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const IMAGE_ACCEPT = IMAGE_TYPES.join(",");

/**
 * Some browsers report an empty MIME type for dragged files, so the extension
 * stands in rather than silently dropping the file.
 */
export function isUploadImage(file: File): boolean {
  return IMAGE_TYPES.includes(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name);
}
