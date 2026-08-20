import { describe, it, expect } from "vitest";
import { currentAthlete, fieldSize } from "./current-athlete";

const ep = (running_order: number, participation_status: string) => ({
  running_order,
  participation_status,
});

describe("currentAthlete", () => {
  it("prefers whoever the admin put on the clock", () => {
    const parts = [ep(1, "waiting"), ep(4, "running")];
    expect(currentAthlete(parts)).toEqual({ athlete: parts[1], onClock: true });
  });

  it("falls back to the first unfinished athlete in running order", () => {
    const parts = [ep(3, "waiting"), ep(1, "finished"), ep(2, "waiting")];
    expect(currentAthlete(parts)).toEqual({ athlete: parts[2], onClock: false });
  });

  it("skips scratched athletes", () => {
    const parts = [ep(1, "scratched"), ep(2, "waiting")];
    expect(currentAthlete(parts).athlete).toBe(parts[1]);
  });

  it("returns nothing once the field is done", () => {
    expect(currentAthlete([ep(1, "finished")])).toEqual({ athlete: null, onClock: false });
  });
});

describe("fieldSize", () => {
  it("excludes scratched athletes", () => {
    expect(fieldSize([ep(1, "waiting"), ep(2, "scratched"), ep(3, "finished")])).toBe(2);
  });
});
