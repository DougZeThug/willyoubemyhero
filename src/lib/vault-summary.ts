// The one line under the Today card that says how the collection is going.
//
// A single function rather than an expression in the vault's JSX, for one reason:
// the rule it has to keep is a NEGATIVE one — nothing on this screen may say how
// big a secret set is, or how much of one is missing (§9) — and a rule you can
// only check by reading markup is a rule that gets broken by the next person who
// adds a clause. Here it is one test, over every shape the line can take.
//
// The roster is the exception and is stated as a fraction on purpose: thirteen
// people, publicly, is the one denominator this app has always been allowed.

/** The numbers behind the line. Every one of them is about what you HOLD. */
export type VaultSummary = {
  /** Roster cards collected. */
  rosterHeld: number;
  /** How many are on the roster at all. Public, so a fraction is fine. */
  rosterSize: number;
  /** Secrets pulled. NEVER how many exist. */
  secrets: number;
  /** How many different sets those came from. Not how many sets there are. */
  sets: number;
  /** Sets finished. The trophy shelf's own count. */
  complete: number;
};

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * "Roster 3 / 13 · Secrets 3 across 2 sets · 1 set complete".
 *
 * Every clause but the first is dropped at zero, on the same rule as
 * `secretsPulledLabel` and `packedByLabel`: "0 secrets" would announce that a set
 * exists at all, and "0 sets complete" is a running reminder of something you
 * have not done on the one screen whose whole posture is to show what you have.
 */
export function vaultSummaryLine(s: VaultSummary): string {
  const parts = [`Roster ${s.rosterHeld} / ${s.rosterSize}`];
  // "across N sets" and never "of N": the number is how many sets you have
  // touched, which is a fact about your collection, not about the catalogue.
  if (s.secrets > 0) {
    parts.push(`Secrets ${s.secrets} across ${s.sets} ${plural(s.sets, "set", "sets")}`);
  }
  if (s.complete > 0) {
    parts.push(`${s.complete} ${plural(s.complete, "set", "sets")} complete`);
  }
  return parts.join(" · ");
}
