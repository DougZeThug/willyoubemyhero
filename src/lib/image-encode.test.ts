import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeUploadImageVariants, imageTypeOf, snapshotFile } from "./image-encode";

// The server accepts exactly these four, per decodeImageDataUrl in media.functions.
const SERVER_ACCEPTS = /^data:image\/(png|jpeg|jpg|webp);base64,/;

describe("snapshotFile", () => {
  it("copies the bytes into a detached file", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "card.png", { type: "image/png" });
    const snap = await snapshotFile(file);
    expect(snap.name).toBe("card.png");
    expect(snap.type).toBe("image/png");
    expect(new Uint8Array(await snap.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("turns a revoked handle into guidance the admin can act on", async () => {
    // What Android throws when the gallery handle dies between pick and save.
    const dead = {
      name: "juatbot.png",
      type: "image/png",
      lastModified: 0,
      arrayBuffer: () => Promise.reject(new DOMException("nope", "NotReadableError")),
    } as unknown as File;
    await expect(snapshotFile(dead)).rejects.toThrow(/pick it again/i);
  });
});

describe("imageTypeOf", () => {
  it("keeps a type the browser already gave", () => {
    expect(imageTypeOf(new File([], "card.webp", { type: "image/webp" }))).toBe("image/webp");
  });

  it("reads the extension when a dragged file arrives with no type at all", () => {
    // The gates upstream admit these by extension, so labelling them by the same
    // claim is the only thing that keeps the gate and the label in agreement.
    expect(imageTypeOf(new File([], "card.png", { type: "" }))).toBe("image/png");
    expect(imageTypeOf(new File([], "CARD.JPG", { type: "" }))).toBe("image/jpeg");
    expect(imageTypeOf(new File([], "card.jpeg", { type: "" }))).toBe("image/jpeg");
    expect(imageTypeOf(new File([], "card.webp", { type: "" }))).toBe("image/webp");
  });

  it("does not overwrite a real type that disagrees with the extension", () => {
    // A gif named card.png clears the upload gate on its name. Relabelling it
    // image/png would walk it straight past the server's format check and store
    // gif bytes as a png; the honest refusal is the better answer.
    expect(imageTypeOf(new File([], "card.png", { type: "image/gif" }))).toBe("image/gif");
  });

  it("repairs the generic type some browsers report instead of an empty one", () => {
    expect(imageTypeOf(new File([], "card.png", { type: "application/octet-stream" }))).toBe(
      "image/png",
    );
  });

  it("leaves a type it cannot improve on alone", () => {
    // An honest refusal downstream beats mislabelling a gif as a png to get it
    // past the server's check.
    expect(imageTypeOf(new File([], "card.gif", { type: "image/gif" }))).toBe("image/gif");
    expect(imageTypeOf(new File([], "noextension", { type: "" }))).toBe("");
  });
});

describe("encodeUploadImageVariants", () => {
  // jsdom will not decode a blob URL, so the <img> fallback inside loadImage
  // never settles. Standing createImageBitmap up puts these on the real
  // small-file passthrough branch, which is the one a dragged card takes.
  function decodesAs(width: number, height: number) {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width, height, close: () => {} }) as unknown as ImageBitmap),
    );
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("labels every variant with a type the server accepts, from an empty-type file", async () => {
    // A dragged PNG. Every passthrough forwards the original bytes, and the
    // server reads the type off the prefix — so an empty type meant the upload
    // came back "Unsupported image format" with no hint as to why.
    decodesAs(1, 1);
    const file = new File([new Uint8Array([1, 2, 3])], "card.png", { type: "" });
    const sizes = await encodeUploadImageVariants(file);
    expect(sizes.large).toMatch(SERVER_ACCEPTS);
    expect(sizes.medium).toMatch(SERVER_ACCEPTS);
    expect(sizes.thumb).toMatch(SERVER_ACCEPTS);
  });

  it("repairs the zero-dimension passthrough too", async () => {
    // The !w || !h branch, which returns the raw read for all three sizes.
    decodesAs(0, 0);
    const file = new File([new Uint8Array([1, 2, 3])], "card.webp", { type: "" });
    const sizes = await encodeUploadImageVariants(file);
    expect(sizes.large.startsWith("data:image/webp;base64,")).toBe(true);
  });

  it("still labels a file the browser typed itself", async () => {
    decodesAs(1, 1);
    const file = new File([new Uint8Array([1, 2, 3])], "card.webp", { type: "image/webp" });
    const sizes = await encodeUploadImageVariants(file);
    expect(sizes.large.startsWith("data:image/webp;base64,")).toBe(true);
  });

  it("refuses a gif wearing a .png name rather than relabelling it", async () => {
    decodesAs(1, 1);
    const file = new File([new Uint8Array([1, 2, 3])], "card.png", { type: "image/gif" });
    const sizes = await encodeUploadImageVariants(file);
    expect(sizes.large).not.toMatch(SERVER_ACCEPTS);
  });

  it("re-encodes a file that is small in pixels but not in bytes", async () => {
    // 1200px fits under the 1600px edge, so nothing needed shrinking — but at
    // 400 KB+ it is over the passthrough budget. It used to store the original
    // as `large` anyway, and signSet serves `large` untransformed whenever a
    // medium variant exists, so the phone downloaded the full PNG.
    decodesAs(1200, 900);
    const ENCODED = "data:image/webp;base64,RU5DT0RFRA==";
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation((type?: string) =>
      type === "image/webp" ? ENCODED : "data:,",
    );
    const file = new File([new Uint8Array(400_001)], "card.png", { type: "image/png" });
    const sizes = await encodeUploadImageVariants(file);
    expect(sizes.large).toBe(ENCODED);
  });

  it("still refuses a file it can identify no other way", async () => {
    // Nothing to read a type off, so the server's "Unsupported image format" is
    // the honest answer and this must not invent one.
    decodesAs(1, 1);
    const file = new File([new Uint8Array([1, 2, 3])], "mystery", { type: "" });
    const sizes = await encodeUploadImageVariants(file);
    expect(sizes.large).not.toMatch(SERVER_ACCEPTS);
  });
});

describe("snapshotFile MIME repair", () => {
  it("carries the repaired type onto the staged copy", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "card.png", { type: "" });
    expect((await snapshotFile(file)).type).toBe("image/png");
  });
});
