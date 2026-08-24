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

  const { error: identityError } = await supabaseAdmin
    .from("account_identities")
    .upsert(
      { user_id: userId, participant_id: created.id, guest_id: null },
      { onConflict: "user_id" },
    );
  if (identityError) throw identityError;

  await mergeGuests(created.id, [row?.guest_id ?? "", ...deviceGuestIds]);

  const { token, expiresAt } = signMemberToken(created.id);
  return { participantId: created.id, name: created.name, token, expiresAt };
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
