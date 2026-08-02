import { describe, expect, it } from "vitest";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  anchorOffset,
  clampOffset,
  clampZoom,
  normalizeWheelDelta,
  stepIndex,
  swipeDirection,
  zoomFromWheel,
} from "./zoom";

describe("clampZoom", () => {
  it("holds the ends", () => {
    expect(clampZoom(0.2)).toBe(MIN_ZOOM);
    expect(clampZoom(99)).toBe(MAX_ZOOM);
    expect(clampZoom(2)).toBe(2);
  });
});

describe("normalizeWheelDelta", () => {
  it("converts lines and pages to pixels", () => {
    expect(normalizeWheelDelta(3, 0)).toBe(3);
    expect(normalizeWheelDelta(3, 1)).toBe(48);
    expect(normalizeWheelDelta(3, 2)).toBe(300);
  });
});

describe("zoomFromWheel", () => {
  it("zooms in on a negative delta and out on a positive one", () => {
    expect(zoomFromWheel(2, -100)).toBeGreaterThan(2);
    expect(zoomFromWheel(2, 100)).toBeLessThan(2);
  });

  it("does not slam into the clamp over a burst of small deltas", () => {
    // A trackpad flick is dozens of events. A fixed factor per event would be at
    // MAX_ZOOM long before this loop ends.
    let z = MIN_ZOOM;
    for (let i = 0; i < 20; i += 1) z = zoomFromWheel(z, -4);
    expect(z).toBeLessThan(1.2);
  });
});

describe("anchorOffset", () => {
  it("keeps the point under the cursor still", () => {
    const point = { x: 120, y: 80 };
    const before = { x: -10, y: -20 };
    const next = anchorOffset(before, point, 1, 2);
    // content coordinate under the cursor, before and after
    const uBefore = (point.x - before.x) / 1;
    const uAfter = (point.x - next.x) / 2;
    expect(uAfter).toBeCloseTo(uBefore, 6);
  });
});

describe("clampOffset", () => {
  const size = { width: 300, height: 400 };

  it("never shows empty space beside the card", () => {
    expect(clampOffset({ x: 50, y: 50 }, 2, size)).toEqual({ x: 0, y: 0 });
    expect(clampOffset({ x: -9999, y: -9999 }, 2, size)).toEqual({ x: -300, y: -400 });
  });

  it("pins to the origin at 1x", () => {
    expect(clampOffset({ x: -20, y: 30 }, 1, size)).toEqual({ x: 0, y: 0 });
  });
});

describe("swipeDirection", () => {
  it("reads a fast horizontal throw", () => {
    expect(swipeDirection(-90, 4, 200)).toBe(1);
    expect(swipeDirection(90, 4, 200)).toBe(-1);
  });

  it("ignores a scroll, a nudge and a slow drag", () => {
    expect(swipeDirection(60, 120, 200)).toBe(0);
    expect(swipeDirection(10, 2, 200)).toBe(0);
    expect(swipeDirection(-90, 4, 2000)).toBe(0);
  });
});

describe("stepIndex", () => {
  it("wraps both ways", () => {
    expect(stepIndex(0, 3, -1)).toBe(2);
    expect(stepIndex(2, 3, 1)).toBe(0);
    expect(stepIndex(1, 3, 1)).toBe(2);
  });
});