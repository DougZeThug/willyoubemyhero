// Getting the shared card right before it is rasterised.
//
// The exporter used to cache-bust the artwork URL — appending a query parameter
// to a SIGNED Supabase URL, whose signature covers the query string — and every
// caller slept a fixed 100ms or 350ms and hoped. Both produce the same visible
// failure: a card in the group chat showing initials where a face should be.
import { describe, expect, it, vi } from "vitest";
import { waitForPaint } from "./share-card";

function nodeWith(images: { complete: boolean }[]): HTMLElement {
  const node = document.createElement("div");
  for (const spec of images) {
    const img = document.createElement("img");
    Object.defineProperty(img, "complete", { value: spec.complete });
    node.appendChild(img);
  }
  return node;
}

describe("waitForPaint", () => {
  it("resolves immediately when every image is already loaded", async () => {
    await expect(
      waitForPaint(nodeWith([{ complete: true }, { complete: true }])),
    ).resolves.toBeUndefined();
  });

  it("waits for an image that has not landed yet", async () => {
    const node = nodeWith([{ complete: false }]);
    const img = node.querySelector("img")!;
    let settled = false;
    const pending = waitForPaint(node).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    img.dispatchEvent(new Event("load"));
    await pending;
    expect(settled).toBe(true);
  });

  it("does not hang on an image that fails", async () => {
    // A missing face is worth less than no card at all.
    const node = nodeWith([{ complete: false }]);
    const img = node.querySelector("img")!;
    const pending = waitForPaint(node);
    img.dispatchEvent(new Event("error"));
    await expect(pending).resolves.toBeUndefined();
  });

  it("waits for webfonts, which html-to-image inlines as it walks the DOM", async () => {
    let release: () => void = () => {};
    const fonts = { ready: new Promise<void>((r) => (release = r)) };
    const previous = Object.getOwnPropertyDescriptor(document, "fonts");
    Object.defineProperty(document, "fonts", { value: fonts, configurable: true });
    try {
      let settled = false;
      const pending = waitForPaint(nodeWith([])).then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);
      release();
      await pending;
      expect(settled).toBe(true);
    } finally {
      if (previous) Object.defineProperty(document, "fonts", previous);
    }
  });
});

describe("exportCardPng", () => {
  it("never cache-busts, because the artwork URL is signed", async () => {
    const toPng = vi.fn().mockResolvedValue("data:image/png;base64,AAAA");
    vi.doMock("html-to-image", () => ({ toPng }));
    // fetch is only reached for the blob; a share that cannot build one still
    // must not have cache-busted on the way.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ blob: async () => new Blob([""], { type: "image/png" }) }),
    );
    const { exportCardPng } = await import("./share-card");
    const node = document.createElement("div");
    await exportCardPng(node, "card.png").catch(() => {});
    expect(toPng).toHaveBeenCalledWith(node, expect.objectContaining({ cacheBust: false }));
    vi.unstubAllGlobals();
    vi.doUnmock("html-to-image");
  });
});
