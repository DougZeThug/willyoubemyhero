// A collector is a signed-in account that is not a combine athlete.
//
// Everything downstream of the trading post — the RPCs, the card tables, the
// feed — identifies a party by a participant id, so the cheapest way to let a
// non-player trade is to give them a participant row of their own and mark it.
// `is_collector` is what keeps them off the roster, the claim list and the
// draft while leaving every trading rule untouched.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
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
  deviceGuestId: string | null,
): Promise<CollectorIdentity> {
  const { data: row } = await supabaseAdmin
    .from("account_identities")
    .select("participant_id, guest_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (row?.participant_id) {
    throw new Error("This account already has a player");
  }

  const { data: created, error } = await supabaseAdmin
    .from("participants")
    .insert({ name: displayName, active: true, is_collector: true })
    .select("id, name")
    .single();
  if (error || !created) throw error ?? new Error("Could not create your collector");

  await supabaseAdmin
    .from("account_identities")
    .upsert(
      { user_id: userId, participant_id: created.id, guest_id: null },
      { onConflict: "user_id" },
    );

  // Whatever they pulled before naming themselves is theirs. Swallowed on
  // failure for the same reason as a paper-code claim: an identity that exists
  // beats an identity that half-exists, and the cards can be reconciled later.
  for (const guestId of new Set(
    [row?.guest_id ?? null, deviceGuestId].filter(Boolean) as string[],
  )) {
    try {
      await supabaseAdmin.rpc("claim_guest_secrets", {
        _participant_id: created.id,
        _guest_id: guestId,
      });
      await supabaseAdmin.rpc("claim_guest_packs", {
        _participant_id: created.id,
        _guest_id: guestId,
      });
    } catch {
      /* the collector stands; the cards can be granted back */
    }
  }

  const { token, expiresAt } = signMemberToken(created.id);
  return { participantId: created.id, name: created.name, token, expiresAt };
}
