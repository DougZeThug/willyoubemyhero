import type { ResultCardData } from "@/components/result-card";

/**
 * Rasterise an offscreen node and hand it to the share sheet, or download it.
 *
 * The size is passed explicitly rather than measured: the node lives at
 * top:-10000 with no layout anyone should trust, and html-to-image needs to be
 * told how big the canvas is. Defaults are the 1080x1350 share poster, which is
 * what every caller wanted until the card front became printable in its own
 * right at a different aspect.
 */
export async function exportCardPng(
  node: HTMLElement,
  filename: string,
  size: { width: number; height: number } = { width: 1080, height: 1350 },
) {
  const { toPng } = await import("html-to-image");
  const dataUrl = await toPng(node, {
    cacheBust: true,
    pixelRatio: 1,
    width: size.width,
    height: size.height,
  });
  const blob = await (await fetch(dataUrl)).blob();
  const file = new File([blob], filename, { type: "image/png" });
  const nav = navigator as Navigator & {
    canShare?: (d: { files: File[] }) => boolean;
    share?: (d: { files: File[]; title?: string }) => Promise<void>;
  };
  if (nav.canShare?.({ files: [file] }) && nav.share) {
    try {
      await nav.share({ files: [file], title: filename });
      return;
    } catch {
      /* fall through */
    }
  }
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.click();
}

export type { ResultCardData };
