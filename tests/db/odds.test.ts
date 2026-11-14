// The pull odds live twice: as basis-point tables in TypeScript (shown on the card
// back, `editionOddsLabel`) and as thresholds hard-coded inside three SQL bodies
// that actually decide the roll. Nothing else ties them together, so a rate change
// made in only one place would quietly make the screen lie about the game.
//
// Two checks per roll. The thresholds are read back out of the function source
// and compared exactly with the cumulative TS table, which pins every boundary.
// Then the real function is sampled and the observed share of each rung is held
// to its TS rate within five standard deviations, which pins what the function
// DOES rather than how it is spelled, so a rewrite that keeps the odds still passes.
import { afterAll, describe, expect, it } from "vitest";
import { closeDb, sql } from "./helpers";
import { EDITION_BP_TOTAL, EDITION_ORDER, EDITION_WEIGHTS_BP } from "../../src/lib/card-edition";
import {
  SECRET_TIER_BP_TOTAL,
  SECRET_TIER_ORDER,
  SECRET_TIER_WEIGHTS_BP,
} from "../../src/lib/secret-rarity";

afterAll(closeDb);

/** Rungs rarest first, each with the cumulative threshold SQL compares the draw against. */
function cumulative(order: readonly string[], weights: Readonly<Record<string, number>>) {
  let running = 0;
  return order.slice(0, -1).map((name) => {
    running += weights[name];
    return { name, below: running };
  });
}

const EDITION_THRESHOLDS = cumulative(EDITION_ORDER, EDITION_WEIGHTS_BP);
const SECRET_THRESHOLDS = cumulative(SECRET_TIER_ORDER, SECRET_TIER_WEIGHTS_BP);

async function functionSource(name: string): Promise<string> {
  const rows = await sql<{ prosrc: string }>(
    "SELECT prosrc FROM pg_proc WHERE proname = $1 AND pronamespace = 'public'::regnamespace",
    [name],
  );
  expect(rows).toHaveLength(1);
  return rows[0].prosrc;
}

function readCase(source: string) {
  return [...source.matchAll(/WHEN d\s*<\s*(\d+)\s+THEN\s+'(\w+)'/g)].map((m) => ({
    name: m[2],
    below: Number(m[1]),
  }));
}

/** Observed counts must sit within five standard deviations of the TS rate. */
function expectShares(
  counts: Map<string, number>,
  order: readonly string[],
  weights: Readonly<Record<string, number>>,
  total: number,
  n: number,
) {
  for (const name of order) {
    const p = weights[name] / total;
    const sigma = Math.sqrt(n * p * (1 - p));
    expect(Math.abs((counts.get(name) ?? 0) - n * p), name).toBeLessThanOrEqual(5 * sigma);
  }
}

describe("the TypeScript odds tables are complete", () => {
  it("sum to the basis-point total the thresholds assume", () => {
    expect(Object.values(EDITION_WEIGHTS_BP).reduce((a, b) => a + b, 0)).toBe(EDITION_BP_TOTAL);
    expect(Object.values(SECRET_TIER_WEIGHTS_BP).reduce((a, b) => a + b, 0)).toBe(
      SECRET_TIER_BP_TOTAL,
    );
    expect(EDITION_BP_TOTAL).toBe(10_000);
    expect(SECRET_TIER_BP_TOTAL).toBe(10_000);
  });
});

describe("edition odds", () => {
  it("roll_card_edition draws against the TypeScript thresholds", async () => {
    expect(readCase(await functionSource("roll_card_edition"))).toEqual(EDITION_THRESHOLDS);
  });

  it("reroll_copy_edition keeps its own copy of the same thresholds", async () => {
    // The re-roll inlines the CASE rather than calling roll_card_edition, because
    // it must be able to re-draw where the pull derivation never does.
    expect(readCase(await functionSource("reroll_copy_edition"))).toEqual(EDITION_THRESHOLDS);
  });

  it("roll_card_edition hands out each finish at its TypeScript rate", async () => {
    // The function is a hash of its inputs, so these 300 000 draws are the same
    // every run: this cannot flake.
    const n = 300_000;
    const rows = await sql<{ edition: string; n: number }>(
      `SELECT public.roll_card_edition($1::uuid, $2::uuid, DATE '2026-01-01' + g) AS edition,
              count(*)::int AS n
         FROM generate_series(1, $3) g
        GROUP BY 1`,
      ["00000000-0000-4000-8000-0000000000a1", "00000000-0000-4000-8000-0000000000e1", n],
    );
    expectShares(
      new Map(rows.map((r) => [r.edition, r.n])),
      EDITION_ORDER,
      EDITION_WEIGHTS_BP,
      EDITION_BP_TOTAL,
      n,
    );
  });
});

describe("secret tier odds", () => {
  it("roll_secret_tier draws against the TypeScript thresholds", async () => {
    const source = await functionSource("roll_secret_tier");
    const found = [...source.matchAll(/_d\s*<\s*(\d+)\s+THEN\s+RETURN\s+'(\w+)'/g)].map((m) => ({
      name: m[2],
      below: Number(m[1]),
    }));
    expect(found).toEqual(SECRET_THRESHOLDS);
  });

  it("roll_secret_tier hands out each tier at its TypeScript rate", async () => {
    // Random, so five sigma: about one run in a million is allowed to disagree.
    const n = 300_000;
    const rows = await sql<{ tier: string; n: number }>(
      `SELECT public.roll_secret_tier() AS tier, count(*)::int AS n
         FROM generate_series(1, $1) GROUP BY 1`,
      [n],
    );
    expectShares(
      new Map(rows.map((r) => [r.tier, r.n])),
      SECRET_TIER_ORDER,
      SECRET_TIER_WEIGHTS_BP,
      SECRET_TIER_BP_TOTAL,
      n,
    );
  });
});
