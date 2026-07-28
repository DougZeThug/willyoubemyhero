import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const KEY = "wwbh:device-id";

async function freshModule() {
  vi.resetModules();
  return import("./device-id");
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("deviceId", () => {
  it("mints an id on first read and keeps it", async () => {
    const { deviceId } = await freshModule();
    const first = deviceId();
    expect(first).toBeTruthy();
    expect(localStorage.getItem(KEY)).toBe(first);
    expect(deviceId()).toBe(first);
  });

  it("survives a reload — the pack must not change under someone at midday", async () => {
    const { deviceId } = await freshModule();
    const first = deviceId();
    const { deviceId: again } = await freshModule();
    expect(again()).toBe(first);
  });

  it("gives two devices different ids, which is what makes their packs differ", async () => {
    const { deviceId } = await freshModule();
    const a = deviceId();
    localStorage.clear();
    expect(deviceId()).not.toBe(a);
  });

  it("still returns an id when localStorage refuses, rather than no pack at all", async () => {
    // Private mode, or a full quota. A per-session id is a worse promise than a
    // persistent one and a much better failure than a screen with nothing on it.
    const { deviceId } = await freshModule();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const first = deviceId();
    expect(first).toBeTruthy();
    // Stable for the life of the page, so the pack does not reroll on re-render.
    expect(deviceId()).toBe(first);
  });
});
