import type { ResultCardData } from "@/components/result-card";

/**
 * Wait until everything inside `node` has actually painted.
 *
 * The callers used to sleep a fixed 100ms or 350ms and hope. That is either
 * wasted time on wifi or not enough on a phone in a garden, and not enough
 * means a card shared to the group chat showing initials where a face should
 * be. Resolves on a broken image too: a missing face is worth less than no
 * card at all.
 */
export async function waitForPaint(node: HTMLElement) {
  const images = [...node.querySelectorAll("img")].filter((img) => !img.complete);
  await Promise.all([
    ...images.map(
      (img) =>
        new Promise<void>((resolve) => {
          img.addEventListener("load", () => resolve(), { once: true });
          img.addEventListener("error", () => resolve(), { once: true });
        }),
    ),
    // Webfonts are part of the picture; html-to-image inlines the glyphs it
    // finds at the moment it walks the DOM.
    document.fonts?.ready ?? Promise.resolve(),
  ]);
  // One frame, so the layout that those loads triggered has been applied.
  await new Promise((r) => requestAnimationFrame(() => r(null)));
}

export async function exportCardPng(node: HTMLElement, filename: string) {
  const { toPng } = await import("html-to-image");
  const dataUrl = await toPng(node, {
    // NOT cacheBust. It appends a query parameter to every image URL, and the
    // artwork here is a SIGNED Supabase URL whose signature covers the query
    // string — so the fetch 400s and the card exports with initials where the
    // face should be. waitForPaint above is what makes the freshness the
    // cache-bust was reaching for.
    cacheBust: false,
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
