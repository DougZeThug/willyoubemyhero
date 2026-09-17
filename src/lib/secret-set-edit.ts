// Turning a refused set edit into something the commissioner can act on.
//
// Its own module rather than a corner of secret-cards.ts, for the reason that
// module's importers give away: the pack, the vault, /you and the trade screen
// all read it, so anything living there is in the chunk every player downloads.
// This copy is only ever read by one admin panel, and a player has no use for
// five ways a set edit can be refused.
//
// And not exported from the panel itself: the panel is a component file, and a
// second export there is a react-refresh warning on a file that has none.

/**
 * Why a set edit was refused, in words the commissioner can do something with.
 *
 * Every arm is a `{ ok: false, reason }` one of the three set handlers in
 * secret-cards.functions.ts can answer with — they resolve rather than throw,
 * so the refusal arrives down the SUCCESS arm of the panel's toast and has only
 * the reason code to explain itself from.
 *
 * Two of them used to fall through to the name line: a delete refused because
 * somebody has already finished the set, and an edit to a set another tab had
 * already removed. Both then blamed the name — which a delete never sends — and
 * offered "try letters and numbers", which is no way out of either. Hiding IS
 * the way out of the first, and it is one icon along the same row.
 *
 * The name line stays the default, because `bad_name` is still why a create is
 * refused, and a reason this does not know is far likelier to be a new
 * validation than a new kind of conflict.
 */
export function setEditRefusal(reason: string | undefined): string {
  switch (reason) {
    case "in_use":
      return "That set still has cards in it — hide it instead";
    case "has_trophies":
      return "Somebody has already finished that set — hide it instead";
    case "not_found":
      return "That set is already gone — pull to refresh";
    case "exists":
      return "There's already a set with that name";
    default:
      return "That name doesn't work — try letters and numbers";
  }
}
