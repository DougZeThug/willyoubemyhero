// Warming card art before a reveal. The only property that matters is that this
// can never strand the sequence — a card that failed to preload is still a card
// the user is entitled to turn over.
import { afterEach, describe, expect, it, vi } from "vitest";

import { preloadImage } from "./preload";

/** Stand in for HTMLImageElement with a decode() we control. */
function stubImage(decode: () => Promise<void>) {
  const instances: { src: string; crossOrigin: string | null }[] = [];
  class FakeImage {
    src = "";
    crossOrigin: string | null = null;
    decoding = "";
    constructor() {
      instances.push(this);
    }
    decode = decode;
  }
  vi.stubGlobal("Image", FakeImage);
  return instances;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("preloadImage", () => {
  it("decodes the image it was given", async () => {
    const instances = stubImage(() => Promise.resolve());
    await preloadImage("https://example.test/card.webp");
    expect(instances).toHaveLength(1);
    expect(instances[0].src).toBe("https://example.test/card.webp");
  });

  // HoloCard renders card art with crossOrigin="anonymous". A preload that does
  // not match fetches the same bytes twice instead of warming anything.
  it("requests it the same way the card will", async () => {
    const instances = stubImage(() => Promise.resolve());
    await preloadImage("https://example.test/card.webp");
    expect(instances[0].crossOrigin).toBe("anonymous");
  });

  it("resolves rather than throwing when the image cannot be decoded", async () => {
    stubImage(() => Promise.reject(new Error("decode failed")));
    await expect(preloadImage("https://example.test/broken.webp")).resolves.toBeUndefined();
  });

  it("does nothing at all without a url", async () => {
    const instances = stubImage(() => Promise.resolve());
    await preloadImage(null);
    await preloadImage(undefined);
    await preloadImage("");
    expect(instances).toHaveLength(0);
  });
});
