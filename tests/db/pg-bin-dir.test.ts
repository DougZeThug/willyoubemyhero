import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { pickPgBinDir, versionedBinDirs } from "./cluster";

const has =
  (...dirs: string[]) =>
  (dir: string) =>
    dirs.includes(dir);

describe("pickPgBinDir", () => {
  it("uses PG_BIN_DIR when it holds initdb", () => {
    expect(
      pickPgBinDir({
        fromEnv: "/opt/pg/bin",
        versioned: ["/usr/lib/postgresql/17/bin"],
        fixed: [],
        has: has("/opt/pg/bin", "/usr/lib/postgresql/17/bin"),
      }),
    ).toBe("/opt/pg/bin");
  });

  it("falls through when PG_BIN_DIR points at a directory that is not there", () => {
    // CI's fallback guess was .../16/bin; a runner image that ships a newer
    // major version used to fail the whole suite on that one stale path.
    expect(
      pickPgBinDir({
        fromEnv: "/usr/lib/postgresql/16/bin",
        versioned: ["/usr/lib/postgresql/17/bin"],
        fixed: ["/usr/bin"],
        has: has("/usr/lib/postgresql/17/bin"),
      }),
    ).toBe("/usr/lib/postgresql/17/bin");
  });

  it("prefers a versioned directory over the fixed ones, in the order given", () => {
    expect(
      pickPgBinDir({
        versioned: ["/usr/lib/postgresql/17/bin", "/usr/lib/postgresql/16/bin"],
        fixed: ["/usr/bin"],
        has: has("/usr/lib/postgresql/16/bin", "/usr/lib/postgresql/17/bin", "/usr/bin"),
      }),
    ).toBe("/usr/lib/postgresql/17/bin");
  });

  it("names the fix when nothing is installed", () => {
    expect(() => pickPgBinDir({ versioned: [], fixed: ["/usr/bin"], has: has() })).toThrow(
      /set PG_BIN_DIR/,
    );
  });
});

describe("versionedBinDirs", () => {
  it("lists installed major versions newest first, numerically, ignoring junk", () => {
    const root = mkdtempSync(path.join(tmpdir(), "pg-versions-"));
    for (const name of ["9.6", "15", "16", "17", "16-beta", "latest"]) {
      mkdirSync(path.join(root, name));
    }
    // A string sort would put "9.6" above "17"; the number is what matters.
    expect(versionedBinDirs(root).map((dir) => path.basename(path.dirname(dir)))).toEqual([
      "17",
      "16",
      "15",
      "9.6",
    ]);
  });

  it("is empty when the directory does not exist", () => {
    expect(versionedBinDirs(path.join(tmpdir(), "no-such-postgres-root"))).toEqual([]);
  });
});
