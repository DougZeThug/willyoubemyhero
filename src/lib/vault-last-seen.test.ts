import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  ACQUISITION_WINDOW_MS,
  acquisitionWindow,
  isNewSince,
  markVaultSeen,
  readVaultLastSeen,
  useVaultLastSeen,
} from "./vault-last-seen";

const KEY = "wwbh:vault-last-seen";
const NOW = Date.parse("2026-09-05T12:00:00.000Z");

beforeEach(() => {
  window.localStorage.clear();
  // The module cache as well as storage: the writes deliberately trust their own
  // value over a re-read, so clearing only storage would leak between tests.
  markVaultSeen("");
  window.localStorage.clear();
});

describe("acquisitionWindow", () => {
  it("asks for exactly a day, whatever the device last saw", () => {
    // §12's "the strip disappears after 24 h", and deliberately not anchored on
    // the last visit: tapping the strip moves that instant, and the card page you
    // land on needs the same rows a moment later.
    expect(acquisitionWindow(NOW)).toBe(new Date(NOW - ACQUISITION_WINDOW_MS).toISOString());
  });
});

describe("isNewSince", () => {
  const anHourAgo = new Date(NOW - 60 * 60_000).toISOString();
  const yesterday = new Date(NOW - 20 * 60 * 60_000).toISOString();

  it("says nothing is new to a device that has never stored a visit", () => {
    // The `primed` problem trophy-seen.ts names. An absent value is "we do not
    // know", and answering it with "everything" would hand somebody restoring on
    // a new handset a strip celebrating a collection they built months ago.
    expect(isNewSince(anHourAgo, null)).toBe(false);
  });

  it("counts what landed after the last visit", () => {
    expect(isNewSince(anHourAgo, yesterday)).toBe(true);
  });

  it("does not count what was already there", () => {
    expect(isNewSince(yesterday, anHourAgo)).toBe(false);
  });

  it("does not count an arrival stamped exactly at the last visit", () => {
    expect(isNewSince(anHourAgo, anHourAgo)).toBe(false);
  });

  it("treats a visit it cannot parse as no visit at all", () => {
    expect(isNewSince(anHourAgo, "the other day")).toBe(false);
  });

  it("treats an arrival it cannot parse as not news", () => {
    expect(isNewSince("soon", yesterday)).toBe(false);
  });
});

describe("the stored visit", () => {
  it("round-trips through storage", () => {
    markVaultSeen("2026-09-05T09:00:00.000Z");
    expect(window.localStorage.getItem(KEY)).toBe("2026-09-05T09:00:00.000Z");
    expect(readVaultLastSeen()).toBe("2026-09-05T09:00:00.000Z");
  });

  it("reads junk under its key as never visited", () => {
    window.localStorage.setItem(KEY, "not a date");
    expect(readVaultLastSeen()).toBeNull();
  });
});

describe("useVaultLastSeen", () => {
  it("seeds a device that has never visited, and shows it nothing", () => {
    const { result } = renderHook(() => useVaultLastSeen());
    // Nothing reads as new on this load, which is the silent first visit...
    expect(result.current).toBeNull();
    expect(isNewSince(new Date().toISOString(), result.current)).toBe(false);
    // ...but the seed is written, so the next one has something to measure from.
    expect(readVaultLastSeen()).not.toBeNull();
  });

  it("hands back a stored visit and follows a later write", () => {
    window.localStorage.setItem(KEY, "2026-09-05T09:00:00.000Z");
    const { result } = renderHook(() => useVaultLastSeen());
    expect(result.current).toBe("2026-09-05T09:00:00.000Z");

    act(() => markVaultSeen("2026-09-05T11:00:00.000Z"));
    expect(result.current).toBe("2026-09-05T11:00:00.000Z");
  });

  it("keeps working when storage refuses the write", () => {
    // Private mode. The strip must still clear for this page load rather than
    // reappearing under the thumb that dismissed it.
    window.localStorage.setItem(KEY, "2026-09-05T09:00:00.000Z");
    const { result } = renderHook(() => useVaultLastSeen());
    const setItem = window.localStorage.setItem;
    window.localStorage.setItem = () => {
      throw new Error("blocked");
    };
    try {
      act(() => markVaultSeen("2026-09-05T11:00:00.000Z"));
      expect(result.current).toBe("2026-09-05T11:00:00.000Z");
    } finally {
      window.localStorage.setItem = setItem;
    }
  });
});
