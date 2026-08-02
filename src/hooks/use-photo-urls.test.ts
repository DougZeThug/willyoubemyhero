// Signed card and photo URLs, and the localStorage snapshot that lets the vault
// grid start decoding art on the first frame after a reload.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createQueryWrapper } from "@/test/query";

const getEventCardUrls = vi.fn();
const getEventPhotoUrls = vi.fn();

vi.mock("@/lib/media.functions", () => ({
  getEventCardUrls: (...args: unknown[]) => getEventCardUrls(...args),
  getEventPhotoUrls: (...args: unknown[]) => getEventPhotoUrls(...args),
}));

// useServerFn only exists to bind a server function to the router; in a test the
// function itself is already callable.
vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});

const EVENT_ID = "event-1";
const CARD_KEY = `wwbh:v2:card-urls:${EVENT_ID}`;
const CARDS = { "ep-1": { front: "https://cdn/front.webp", back: null } };

beforeEach(() => {
  window.localStorage.clear();
  getEventCardUrls.mockReset().mockResolvedValue(CARDS);
  getEventPhotoUrls.mockReset().mockResolvedValue({});
});

describe("useEventCardUrls", () => {
  it("does not fetch without an event id", async () => {
    const { useEventCardUrls } = await import("./use-photo-urls");
    const { wrapper } = createQueryWrapper();
    renderHook(() => useEventCardUrls(null), { wrapper });
    expect(getEventCardUrls).not.toHaveBeenCalled();
  });

  it("fetches and returns signed urls for an event", async () => {
    const { useEventCardUrls } = await import("./use-photo-urls");
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useEventCardUrls(EVENT_ID), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(CARDS));
    expect(getEventCardUrls).toHaveBeenCalledWith({ data: { eventId: EVENT_ID } });
  });

  it("writes a snapshot to localStorage after a successful fetch", async () => {
    const { useEventCardUrls } = await import("./use-photo-urls");
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useEventCardUrls(EVENT_ID), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(CARDS));
    await waitFor(() => expect(window.localStorage.getItem(CARD_KEY)).toBeTruthy());
    expect(JSON.parse(window.localStorage.getItem(CARD_KEY)!).data).toEqual(CARDS);
  });

  it("seeds the cache from a fresh snapshot so cards paint before the fetch lands", async () => {
    const stored = { "ep-9": { front: "https://cdn/cached.webp", back: null } };
    window.localStorage.setItem(CARD_KEY, JSON.stringify({ at: Date.now(), data: stored }));
    // Never resolves: the only data available is the snapshot.
    getEventCardUrls.mockImplementation(() => new Promise(() => {}));

    const { useEventCardUrls } = await import("./use-photo-urls");
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useEventCardUrls(EVENT_ID), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(stored));
    expect(getEventCardUrls).toHaveBeenCalledWith({ data: { eventId: EVENT_ID } });
  });

  it("ignores snapshots written by an older URL-path strategy", async () => {
    window.localStorage.setItem(
      `wwbh:card-urls:${EVENT_ID}`,
      JSON.stringify({
        at: Date.now(),
        data: { "ep-old": { front: "https://cdn/removed-file.png", back: null } },
      }),
    );
    const { useEventCardUrls } = await import("./use-photo-urls");
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useEventCardUrls(EVENT_ID), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(CARDS));
    expect(result.current.data).not.toHaveProperty("ep-old");
  });

  it("discards a snapshot old enough that its token may be near expiry", async () => {
    const stale = { "ep-9": { front: "https://cdn/stale.webp", back: null } };
    window.localStorage.setItem(
      CARD_KEY,
      // Snapshots are capped at 3.5h, well inside the token's 8h life.
      JSON.stringify({ at: Date.now() - 4 * 60 * 60_000, data: stale }),
    );
    const { useEventCardUrls } = await import("./use-photo-urls");
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useEventCardUrls(EVENT_ID), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(CARDS));
    expect(result.current.data).not.toEqual(stale);
  });

  it("ignores a corrupt snapshot", async () => {
    window.localStorage.setItem(CARD_KEY, "{not json");
    const { useEventCardUrls } = await import("./use-photo-urls");
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useEventCardUrls(EVENT_ID), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(CARDS));
  });

  it("ignores a snapshot with no timestamp", async () => {
    window.localStorage.setItem(CARD_KEY, JSON.stringify({ data: { "ep-9": {} } }));
    const { useEventCardUrls } = await import("./use-photo-urls");
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useEventCardUrls(EVENT_ID), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(CARDS));
  });

  it("keeps working when localStorage refuses to write", async () => {
    // Private mode, or a full quota. The query just refetches next time.
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    try {
      const { useEventCardUrls } = await import("./use-photo-urls");
      const { wrapper } = createQueryWrapper();
      const { result } = renderHook(() => useEventCardUrls(EVENT_ID), { wrapper });
      await waitFor(() => expect(result.current.data).toEqual(CARDS));
    } finally {
      setItem.mockRestore();
    }
  });

  it("does not overwrite data already in the query cache with a snapshot", async () => {
    const { client, wrapper } = createQueryWrapper();
    const live = { "ep-live": { front: "https://cdn/live.webp", back: null } };
    client.setQueryData(["card-urls", EVENT_ID], live);
    window.localStorage.setItem(
      CARD_KEY,
      JSON.stringify({ at: Date.now(), data: { "ep-old": { front: "x", back: null } } }),
    );

    const { useEventCardUrls } = await import("./use-photo-urls");
    const { result } = renderHook(() => useEventCardUrls(EVENT_ID), { wrapper });
    expect(result.current.data).toEqual(live);
  });
});

describe("useEventPhotoUrls", () => {
  it("keeps its snapshot under a separate key from the card urls", async () => {
    getEventPhotoUrls.mockResolvedValue({ "ep-1": "https://cdn/photo.jpg" });
    const { useEventPhotoUrls } = await import("./use-photo-urls");
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useEventPhotoUrls(EVENT_ID), { wrapper });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    await waitFor(() =>
      expect(window.localStorage.getItem(`wwbh:v2:photo-urls:${EVENT_ID}`)).toBeTruthy(),
    );
    expect(window.localStorage.getItem(CARD_KEY)).toBeNull();
  });
});
