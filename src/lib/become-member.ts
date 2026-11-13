import type { QueryClient } from "@tanstack/react-query";
import {
  adoptableIds,
  adoptLocalCollection,
  holdForAdoption,
  releaseAdoptionHold,
  type LocalCollection,
} from "./adopt-collection";
import { carryPackToIdentity } from "./card-collection";
import { deviceIdentity, memberIdentity } from "./identity";
import { clearMemberToken, setMemberToken } from "./member-token";
import { carryTrophySeen } from "./trophy-seen";

/**
 * Run `fn`, and once more if it throws and `stillWanted` still holds. The second
 * failure is the one that propagates. One retry, because the usual failure is a
 * flaky first request on a phone in a garden; more would hold the claim screen
 * hostage to a connection that is not coming back.
 */
async function retryOnce<T>(fn: () => Promise<T>, stillWanted: () => boolean): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (!stillWanted()) throw error;
    return await fn();
  }
}

/**
 * A guest handset becomes a member: the one order-sensitive sequence behind both
 * doors, redeeming a code and signing in to an account.
 *
 * `held` is the collection read BEFORE this, because the collection hook starts
 * pruning against the server the instant the token lands.
 *
 * 1. THE CEREMONIES GO ACROSS BEFORE THE TOKEN. The trophy is already banked, and
 *    the token is what hands the root ceremony host a participant id — between
 *    the two, a realtime refetch can find `<participantId>:<set>` unmarked and
 *    queue a ceremony the pack screen already threw as a guest. Nothing here
 *    needs the network (a localStorage re-file), and it is idempotent, so running
 *    it before a claim that might roll back is harmless.
 * 2. HOLD the cards as owed to this member, for the tabs this one cannot see: a
 *    vault in another tab hears the token through `storage` and reconciles on its
 *    own clock, and the hold is the one thing every reconcile already honours.
 * 3. The token has to land before the adoption — `adoptCollection` authenticates
 *    as the member it is filing cards for — but the moment it does, an empty
 *    `card_pulls` reads as "you own nothing" and the prune deletes the guest's
 *    cards. So if the adoption does not stick (after one retry, because the usual
 *    failure is a flaky first request from a phone that has just woken up) the
 *    token comes straight back off and the hold is released: no member, no
 *    reconciliation, nothing pruned, and the code still works next time. That is
 *    reported as "failed" rather than thrown, because the two doors answer it
 *    differently (a toast; a retry loop) and a throw means something else here —
 *    the hold could not be written, which stops the handoff before any token.
 * 4. Release the hold, not awaited: it waits on a refetch, and if that fails the
 *    hold stays — keeping it costs nothing, letting go early loses the card.
 * 5. The guest PACK follows, AFTER the adoption, because the adoption is the
 *    record for those cards and the member must not file them a second time. A
 *    claim moves the pack identity from `d:<deviceId>` to `m:<participantId>`,
 *    which every screen keyed on it reads as the handset changing hands.
 *
 * `isCurrent` is for a caller that can be overtaken mid-flight (an account switch
 * or unmount): once it says no, the run stops without touching the token it may
 * have written — the newer run owns it. `mayCarryPack` is the stricter question
 * for step 5 alone: a pack rewritten to an account the device has already
 * switched away from cannot be carried again, and the next run would deal a
 * second one.
 *
 * Resolves "stale" when it stopped early, "failed" (with the adoption's error)
 * when the cards would not go up, otherwise "adopted".
 */
export async function becomeMember(args: {
  participantId: string;
  token: string;
  name: string;
  held: LocalCollection;
  /** This handset's device id, or null where there is none to carry from. */
  device: string | null;
  qc: QueryClient;
  isCurrent?: () => boolean;
  mayCarryPack?: () => boolean;
  /** Fires the moment the token is on the device, so a caller's cleanup knows it is the author. */
  onTokenWritten?: () => void;
}): Promise<{ status: "adopted" | "stale" } | { status: "failed"; error: unknown }> {
  const { participantId, token, name, held, device, qc } = args;
  const isCurrent = args.isCurrent ?? (() => true);
  const mayCarryPack = args.mayCarryPack ?? (() => true);

  if (device) carryTrophySeen(deviceIdentity(device), participantId);
  await holdForAdoption(participantId, held);
  if (!isCurrent()) {
    // No token went on, so nothing is reconciling and nothing needs holding.
    await releaseAdoptionHold(participantId, held);
    return { status: "stale" };
  }
  setMemberToken(token, name);
  args.onTokenWritten?.();
  try {
    await retryOnce(() => adoptLocalCollection(held), isCurrent);
  } catch (error) {
    if (!isCurrent()) return { status: "stale" };
    clearMemberToken();
    await releaseAdoptionHold(participantId, held);
    return { status: "failed", error };
  }
  if (!isCurrent()) return { status: "stale" };
  void releaseAdoptionHold(participantId, held, qc).catch(() => {
    // The hold simply stays.
  });
  if (device && mayCarryPack()) {
    await carryPackToIdentity(
      deviceIdentity(device),
      memberIdentity(participantId),
      adoptableIds(held),
    );
  }
  return { status: "adopted" };
}
