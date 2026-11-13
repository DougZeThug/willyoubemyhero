/**
 * The league's timezone, which decides where a day ends.
 *
 * Duplicated from SQL rather than derived: every daily thing in this app — the
 * pack drop and the streak among them — bakes `America/New_York` into the
 * function body, precisely so a caller cannot shift the boundary. `leagueDay()`
 * exists so client code agrees with those RPCs about which day it is. A db test
 * pins the two together, the way card-edition.ts and secret-rarity.ts are pinned
 * to their SQL ladders.
 *
 * The pack's day is this day too: the roster re-sealing on the phone's midnight
 * while the secret rolled over on the league's once put the fourth slot out of
 * step with the other three.
 */
export const LEAGUE_TIME_ZONE = "America/New_York";

/** Today in the league's zone, as `YYYY-MM-DD` — the same text a `date` renders as. */
export function leagueDay(at: Date = new Date()): string {
  // en-CA formats as ISO-8601, which is the one locale that needs no reassembly.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: LEAGUE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}
