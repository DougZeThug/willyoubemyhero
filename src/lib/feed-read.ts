/**
 * Which reads of the bundle failed, by what the screens call them. `runs` and
 * `roster` are separate on purpose: a failed roster leaves a correctly placed
 * board of em dashes, so some screens name it apart from the results.
 */
export function feedReadError(failedTables: readonly string[]) {
  return {
    runs: failedTables.includes("runs"),
    roster: failedTables.includes("event_participants"),
    splits: failedTables.includes("splits") || failedTables.includes("stations"),
  };
}

/** The one sentence every spectator screen uses for a failed read. */
export function readFailedMessage(what: "results" | "roster" | "splits" | "votes" | "combine") {
  return `Couldn't read the ${what} just now — retrying.`;
}
