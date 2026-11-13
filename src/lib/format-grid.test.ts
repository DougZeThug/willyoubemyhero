import { describe, expect, it } from "vitest";
import { parseGridTime, snapMs, timeField } from "./format";

describe("the hundredth grid", () => {
  it("snaps stray milliseconds to the nearest hundredth", () => {
    expect(snapMs(15_005)).toBe(15_010);
    expect(snapMs(15_004)).toBe(15_000);
  });

  it("parses typed times onto the grid, and reads blank or junk as null", () => {
    expect(parseGridTime("15.005")).toBe(15_010);
    expect(parseGridTime("1:23.45")).toBe(83_450);
    expect(parseGridTime("")).toBeNull();
    expect(parseGridTime("  ")).toBeNull();
    expect(parseGridTime("abc")).toBeNull();
  });

  it("shows a stored time as a box would hold it, blank for none", () => {
    expect(timeField(null)).toBe("");
    expect(timeField(undefined)).toBe("");
    expect(timeField(83_454)).toBe("1:23.45");
    expect(parseGridTime(timeField(83_454))).toBe(83_450);
  });
});
