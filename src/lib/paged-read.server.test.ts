import { describe, expect, it } from "vitest";
import { readAllRows } from "./paged-read.server";

/** A table of `total` rows that answers `.range(from, to)` the way PostgREST does. */
function table(total: number) {
  const ranges: [number, number][] = [];
  const page = async (from: number, to: number) => {
    ranges.push([from, to]);
    const data = Array.from({ length: Math.max(0, Math.min(to + 1, total) - from) }, (_, i) => ({
      id: from + i,
    }));
    return { data, error: null };
  };
  return { page, ranges };
}

describe("readAllRows", () => {
  it("reads past the 1000-row cap rather than stopping at it", async () => {
    const { page, ranges } = table(2_350);
    const rows = await readAllRows(page);
    expect(rows.map((r) => r.id)).toEqual(Array.from({ length: 2_350 }, (_, i) => i));
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("asks once more when the table is an exact multiple of a page", async () => {
    const { page, ranges } = table(1_000);
    expect(await readAllRows(page)).toHaveLength(1_000);
    expect(ranges).toHaveLength(2);
  });

  it("reads an empty table as no rows, in one query", async () => {
    const { page, ranges } = table(0);
    expect(await readAllRows(page)).toEqual([]);
    expect(ranges).toHaveLength(1);
  });

  it("treats a null page as empty", async () => {
    expect(await readAllRows(async () => ({ data: null, error: null }))).toEqual([]);
  });

  it("throws on a failed page instead of returning what was read so far", async () => {
    let calls = 0;
    const failing = async (from: number, to: number) => {
      calls++;
      if (calls === 2) return { data: null, error: { message: "page 2 failed" } };
      return { data: Array.from({ length: to - from + 1 }, (_, i) => from + i), error: null };
    };
    await expect(readAllRows(failing)).rejects.toMatchObject({ message: "page 2 failed" });
  });
});
