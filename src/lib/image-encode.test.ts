import { describe, expect, it } from "vitest";
import { snapshotFile } from "./image-encode";

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
