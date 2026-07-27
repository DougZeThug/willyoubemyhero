import type { ResultCardData } from "@/components/result-card";

export async function exportCardPng(node: HTMLElement, filename: string) {
  const { toPng } = await import("html-to-image");
  const dataUrl = await toPng(node, {
    cacheBust: true,
    pixelRatio: 1,
    width: 1080,
    height: 1350,
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
