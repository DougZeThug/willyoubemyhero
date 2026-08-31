// A collector is a signed-in account that is not a combine athlete.
//
// Everything downstream of the trading post — the RPCs, the card tables, the
// feed — identifies a party by a participant id, so the cheapest way to let a
// non-player trade is to give them a participant row of their own and mark it.
// `is_collector` is what keeps them off the roster, the claim list and the
// draft while leaving every trading rule untouched.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
// The streak claims are not in types.ts yet, so they need the widened client.
import { streaksDb } from "./streaks-db.server";
import { signMemberToken } from "./session.server";

export type CollectorIdentity = {
  participantId: string;
  name: string;
  token: string;
  expiresAt: number;
};

/**
 * Turn an account into a tradeable collector, once.
 *
 * The auth user comes from the verified bearer; the guest id from the verified
 * guest token. Neither is ever taken from the payload — a payload-supplied guest
 * id would be a way to harvest somebody else's pulls.
 */
export async function createCollector(
  userId: string,
  displayName: string,
  deviceGuestIds: string[],
): Promise<CollectorIdentity> {
  const { data: row } = await supabaseAdmin
    .from("account_identities")
    .select("participant_id, guest_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (row?.participant_id) {
    const { data: participant, error } = await supabaseAdmin
      .from("participants")
      .select("id, name, is_collector")
      .eq("id", row.participant_id)
      .maybeSingle();
    if (error || !participant?.is_collector) {
      throw error ?? new Error("This account already has a player");
    }
    await mergeGuests(participant.id, deviceGuestIds);
    const { token, expiresAt } = signMemberToken(participant.id);
    return { participantId: participant.id, name: participant.name, token, expiresAt };
  }

  const { data: created, error } = await supabaseAdmin
    .from("participants")
    .insert({ name: displayName, active: true, is_collector: true })
    .select("id, name")
    .single();
  if (error || !created) throw error ?? new Error("Could not create your collector");

  // The account's guest id is captured BEFORE the binding write. The write
  // clears guest_id (the constraint allows exactly one of the two), so anything
  // read afterwards — including by a racing tab — can no longer see it. Holding
  // it here is the only way the merge below can still consume it, and the only
  // way a failed merge can put it back.
  const priorGuestId = row?.guest_id ?? null;

  // Two write shapes, both guarded so a racing tab cannot overwrite a winner:
  // - row exists: one UPDATE sets participant_id and clears guest_id together,
  //   only while participant_id is still NULL.
  // - no row: INSERT. Two tabs signing up at once each reach here with their
  //   own fresh participant; an upsert would let the second one repoint the
  //   account at its row while the first had already absorbed the guest's
  //   cards, stranding them on a participant nothing can reach again
  //   (claim_guest_* nulls guest_id, so the merge cannot be replayed). The
  //   unique violation forces a winner.
  let winnerId = created.id;
  let winnerName = created.name;
  let boundFresh = false;

  if (row) {
    const { data: updated, error: updateError } = await supabaseAdmin
      .from("account_identities")
      .update({ participant_id: created.id, guest_id: null })
      .eq("user_id", userId)
      .is("participant_id", null)
      .select("user_id");
    if (updateError) {
      await supabaseAdmin.from("participants").update({ active: false }).eq("id", created.id);
      throw updateError;
    }
    boundFresh = (updated?.length ?? 0) > 0;
  } else {
    const { error: identityError } = await supabaseAdmin
      .from("account_identities")
      .insert({ user_id: userId, participant_id: created.id, guest_id: null });
    if (identityError) {
      if (identityError.code !== "23505") {
        await supabaseAdmin.from("participants").update({ active: false }).eq("id", created.id);
        throw identityError;
      }
    } else {
      boundFresh = true;
    }
  }

  if (!boundFresh) {
    // Lost the race — the winner's row stands. The row we lost with holds
    // nothing yet; retiring it keeps it off the roster and the trade lists.
    await supabaseAdmin.from("participants").update({ active: false }).eq("id", created.id);
    const { data: winner, error: reReadError } = await supabaseAdmin
      .from("account_identities")
      .select("participant_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (reReadError) throw reReadError;
    if (!winner?.participant_id) throw new Error("Could not create your collector");
    const { data: participant, error: participantError } = await supabaseAdmin
      .from("participants")
      .select("id, name")
      .eq("id", winner.participant_id)
      .maybeSingle();
    if (participantError || !participant) {
      throw participantError ?? new Error("Could not create your collector");
    }
    winnerId = participant.id;
    winnerName = participant.name;
  }

  try {
    await mergeGuests(winnerId, [priorGuestId ?? "", ...deviceGuestIds]);
  } catch (mergeError) {
    // The merge is the only consumer of priorGuestId, and claim_guest_* nulls
    // the source guest as it goes — so a failure partway through must not
    // leave the binding pointing at a collector with the account's guest id
    // already cleared: a retry (especially on another device, with no guest
    // token left locally) would have no way to name that guest again. Put the
    // account row back exactly as it was and retire the fresh participant, so
    // the next attempt replays the whole handoff.
    if (boundFresh) {
      if (priorGuestId) {
        await supabaseAdmin
          .from("account_identities")
          .update({ participant_id: null, guest_id: priorGuestId })
          .eq("user_id", userId)
          .eq("participant_id", winnerId);
      } else {
        // No guest to restore: the row we inserted held nothing else, and the
        // check constraint forbids leaving both columns null, so it goes away.
        await supabaseAdmin
          .from("account_identities")
          .delete()
          .eq("user_id", userId)
          .eq("participant_id", winnerId);
      }
      await supabaseAdmin.from("participants").update({ active: false }).eq("id", winnerId);
    }
    throw mergeError;
  }

  const { token, expiresAt } = signMemberToken(winnerId);
  return { participantId: winnerId, name: winnerName, token, expiresAt };
}

async function mergeGuests(participantId: string, guestIds: string[]) {
  for (const guestId of new Set(guestIds.filter(Boolean))) {
    const { error: secretsError } = await supabaseAdmin.rpc("claim_guest_secrets", {
      _participant_id: participantId,
      _guest_id: guestId,
    });
    if (secretsError) throw secretsError;
    const { error: packsError } = await supabaseAdmin.rpc("claim_guest_packs", {
      _participant_id: participantId,
      _guest_id: guestId,
    });
    if (packsError) throw packsError;
    // After the packs, always: a claim stranded on the dead guest id would let the
    // same milestone pay twice once the streak recomputes against the moved rows.
    const { error: streakError } = await streaksDb().rpc("claim_guest_streak_milestones", {
      _participant_id: participantId,
      _guest_id: guestId,
    });
    if (streakError) throw streakError;
  }
}
