// Warming card art before a reveal. Two properties matter: this can never
// strand the sequence, and it warms the candidate the card will actually
// request — a preload of the wrong width is a fetch nobody uses plus a fetch
// during the flip, which is the exact failure it exists to prevent.
import { afterEach, describe, expect, it, vi } from "vitest";

import { preloadCard } from "./preload";
import { CARD_SIZES } from "@/components/holo-card";

const SET = {
  thumb: "https://example.test/c-320.webp",
  medium: "https://example.test/c-800.webp",
  large: "https://example.test/c-1600.webp",
};

type Captured = { src: string; srcset: string; sizes: string; crossOrigin: string | null };

/** Stand in for HTMLImageElement with a decode() we control. */
function stubImage(decode: () => Promise<void>) {
  const instances: Captured[] = [];
  class FakeImage {
    src = "";
    srcset = "";
    sizes = "";
    crossOrigin: string | null = null;
    decoding = "";
    constructor() {
      instances.push(this as unknown as Captured);
    }
    decode = decode;
  }
  vi.stubGlobal("Image", FakeImage);
  return instances;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("preloadCard", () => {
  it("decodes the image it was given", async () => {
    const instances = stubImage(() => Promise.resolve());
    await preloadCard(SET);
    expect(instances).toHaveLength(1);
    expect(instances[0].src).toBe(SET.large);
  });

  // The card renders every width and lets the browser choose. Warming only the
  // 1600w image missed on any device whose pick was the 800w or 320w one.
  it("offers every width, so the browser warms the one it will render", async () => {
    const instances = stubImage(() => Promise.resolve());
    await preloadCard(SET);
    expect(instances[0].srcset).toContain(SET.thumb);
    expect(instances[0].srcset).toContain(SET.medium);
    expect(instances[0].srcset).toContain(SET.large);
  });

  // Same candidate only if both run the selection algorithm on the same inputs.
  it("uses the card's own sizes attribute", async () => {
    const instances = stubImage(() => Promise.resolve());
    await preloadCard(SET);
    expect(instances[0].sizes).toBe(CARD_SIZES);
  });

  it("requests it the same way the card will", async () => {
    const instances = stubImage(() => Promise.resolve());
    await preloadCard(SET);
    expect(instances[0].crossOrigin).toBe("anonymous");
  });

  it("takes a bare url too, for art that has no size set", async () => {
    const instances = stubImage(() => Promise.resolve());
    await preloadCard("https://example.test/secret.webp");
    expect(instances[0].src).toBe("https://example.test/secret.webp");
  });

  it("resolves rather than throwing when the image cannot be decoded", async () => {
    stubImage(() => Promise.reject(new Error("decode failed")));
    await expect(preloadCard(SET)).resolves.toBeUndefined();
  });

  it("does nothing at all without a url", async () => {
    const instances = stubImage(() => Promise.resolve());
    await preloadCard(null);
    await preloadCard(undefined);
    await preloadCard("");
    await preloadCard({ thumb: null, medium: null, large: null });
    expect(instances).toHaveLength(0);
  });
});
