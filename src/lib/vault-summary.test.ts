// The vault's summary line.
//
// Most of these are ordinary formatting cases. The last describe is the one this
// file exists for: the line may never say how big a secret set is, and the e2e
// suite enforces that over the whole rendered page with two regexes. Checking the
// same two here, over every shape the line can take, is what stops somebody
// adding a clause that only the browser catches.
import { describe, expect, it } from "vitest";
import { vaultSummaryLine } from "./vault-summary";

const base = { rosterHeld: 3, rosterSize: 13, secrets: 0, sets: 0, complete: 0 };

describe("vaultSummaryLine", () => {
  it("always states the roster as a fraction", () => {
    // The one denominator this app has ever been allowed: thirteen people, and
    // the whole league already knows all of them.
    expect(vaultSummaryLine(base)).toBe("Roster 3 / 13");
  });

  it("says nothing at all about secrets to somebody who has pulled none", () => {
    // "0 secrets" would announce that a set exists, which is the one thing the
    // feature withholds.
    expect(vaultSummaryLine({ ...base, secrets: 0, sets: 0 })).not.toMatch(/secret/i);
  });

  it("counts the secrets somebody holds and the sets they came from", () => {
    expect(vaultSummaryLine({ ...base, secrets: 3, sets: 2 })).toBe(
      "Roster 3 / 13 · Secrets 3 across 2 sets",
    );
  });

  it("says one set rather than 1 sets", () => {
    expect(vaultSummaryLine({ ...base, secrets: 1, sets: 1 })).toBe(
      "Roster 3 / 13 · Secrets 1 across 1 set",
    );
  });

  it("stays quiet about completion until there is some", () => {
    expect(vaultSummaryLine({ ...base, complete: 0 })).not.toMatch(/complete/i);
  });

  it("counts finished sets, singular and plural", () => {
    expect(vaultSummaryLine({ ...base, complete: 1 })).toBe("Roster 3 / 13 · 1 set complete");
    expect(vaultSummaryLine({ ...base, complete: 2 })).toBe("Roster 3 / 13 · 2 sets complete");
  });

  it("reads as one line with everything on", () => {
    expect(
      vaultSummaryLine({ rosterHeld: 3, rosterSize: 13, secrets: 3, sets: 2, complete: 1 }),
    ).toBe(
      // prettier-ignore
      "Roster 3 / 13 · Secrets 3 across 2 sets · 1 set complete",
    );
  });

  it("counts an empty roster without dividing by it", () => {
    // Out of season the bundle is empty, so the size is genuinely zero.
    expect(vaultSummaryLine({ ...base, rosterHeld: 0, rosterSize: 0 })).toBe("Roster 0 / 0");
  });
});

describe("the size of a secret set", () => {
  // The two regexes e2e/secrets.spec.ts runs against the whole page body. Run
  // here over every shape the line can take, because that spec can only catch a
  // leak on the one fixture it happens to render.
  const cases = [0, 1, 3, 12];
  for (const secrets of cases) {
    for (const sets of cases) {
      for (const complete of cases) {
        it(`never appears for ${secrets} secrets across ${sets} sets, ${complete} complete`, () => {
          const line = vaultSummaryLine({ rosterHeld: 7, rosterSize: 13, secrets, sets, complete });
          expect(line).not.toMatch(/of \d+ secrets/i);
          expect(line).not.toMatch(/\d+ \/ \d+ secrets/i);
        });
      }
    }
  }
});
