import { createServerFn } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { optionalActor, requireActor } from "./require-auth.server";
import { toEdition } from "./card-edition";
import { signSecretCard } from "./secret-cards.functions";
import type { OpenPackResult, PackStatusResult, SecretCardRow } from "./secret-cards-rows";
import type { OpenPackResponse, PackSlot, PackStatus } from "./pack";
import { sqlNull } from "./rpc-null";

/**
 * Today's pack: dealt by Postgres, three cards from one pool, secrets included.
 *
 * Takes no input at all. Whoever is asking comes from a verified token and every
 * card is chosen server-side, so there is no parameter through which a phone
 * can name a roster id it wants minted or a secret id it wants signed — the
 * INVARIANT at the top of secret-cards.functions.ts, now covering the whole
 * pack. The client-asserted deal this replaces is described at length in the
 * old header of card-pulls.functions.ts; it is gone rather than guarded.
 *
 * Calling again the same league day returns the same pack with `fresh: false`,
 * which is what a reload, a double tap and a second phone all lean on. A guest
 * gets a pack too, keyed on their server-minted `g.` token; their roster slots
 * carry no finish, because nothing is minted for them until they claim.
 */

/** The service-role client, loaded inside the handler so it never reaches the bundle. */
async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/**
 * The same client, widened for the two RPCs the generated types have never
 * heard of. Same workaround secret-cards-rows.ts documents: types.ts is
 * `supabase gen types` output and must not be hand-edited, and `open_pack` and
 * `pack_status` are not in it yet. Shape is recovered per call from the result
 * types in secret-cards-rows.ts.
 */
async function rpc() {
  return (await db()) as unknown as SupabaseClient;
}

/**
 * These responses vary only by a request header, and a cache hit here is
 * somebody else's pack. Latent today — Cloudflare does not cache Worker
 * responses by default — but stated, as it is on the secret handlers.
 */
function noStore() {
  setResponseHeader("Cache-Control", "private, no-store");
}

export const openPack = createServerFn({ method: "POST" }).handler(
  async (): Promise<OpenPackResponse> => {
    const actor = requireActor();
    noStore();
    const sb = await db();

    // The roster half of the pool. A pack out of season has no roster in it and
    // is dealt from the secrets alone, so a missing event is not an error.
    const { data: event } = await sb
      .from("events")
      .select("id")
      .eq("active", true)
      .order("year", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data, error } = await (
      await rpc()
    ).rpc("open_pack", {
      _participant_id: sqlNull(actor.kind === "member" ? actor.id : null),
      _guest_id: sqlNull(actor.kind === "guest" ? actor.id : null),
      _event_id: sqlNull(event?.id ?? null),
    });
    if (error) throw new Error(error.message);

    const pack = data as OpenPackResult;
    // Nothing dealable — no roster and no secrets with art. Soft, so the pack
    // screen can say "nothing today" instead of showing an error.
    if (!pack) return { ok: false, reason: "unavailable" };

    // Only ids the RPC handed back are ever looked up or signed. This is the
    // one place secret rows are read for a member-facing response, and the set
    // is exactly the slots in their pack.
    const secretIds = pack.cards.filter((s) => s.kind === "secret").map((s) => s.id);
    const rows = new Map<string, SecretCardRow>();
    if (secretIds.length > 0) {
      const { data: found, error: rowsError } = await sb
        .from("secret_cards")
        .select("*")
        .in("id", secretIds)
        .returns<SecretCardRow[]>();
      if (rowsError) throw rowsError;
      for (const row of found ?? []) rows.set(row.id, row);
    }

    const cards: PackSlot[] = [];
    for (const slot of pack.cards) {
      if (slot.kind === "roster") {
        cards.push({
          kind: "roster",
          id: slot.id,
          // toEdition rather than a cast, as everywhere a finish crosses a
          // jsonb boundary: an unrecognised value renders as standard. Null
          // stays null — it means "no finish was minted", which the reveal
          // treats as unknown rather than as standard.
          edition: slot.edition == null ? null : toEdition(slot.edition),
          heldBefore: slot.heldBefore ?? null,
          editionBefore: slot.editionBefore == null ? null : toEdition(slot.editionBefore),
        });
        continue;
      }
      // A dealt secret whose catalogue row has since gone. secret_card_pulls
      // RESTRICTs the delete, so this is near-impossible; dropping the slot
      // beats failing the whole pack over it.
      const row = rows.get(slot.id);
      if (!row) continue;
      cards.push({
        kind: "secret",
        id: slot.id,
        card: await signSecretCard(row, slot.tier),
        duplicate: slot.duplicate,
        tierBefore: slot.tierBefore ?? null,
        // Null on every slot that did not just finish a set, which is all but
        // one of them in a season. Null rather than absent, so the client has
        // one shape to check.
        completedCollection: slot.completedCollection ?? null,
      });
    }

    return { ok: true, day: pack.day, fresh: pack.fresh, packsOpened: pack.packsOpened, cards };
  },
);

/**
 * Has today's pack been opened, and how many secrets does this identity own.
 *
 * A pure read — opening the pack screen must never spend the pack. Answers for a
 * device with no identity at all too, with everything false, so the screen can
 * render before a guest session exists without this throwing.
 *
 * `claimed` keeps the name the old secret status used: it has always meant "has
 * an identity that can open a pack" rather than "has claimed a player".
 */
export const getPackStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<PackStatus> => {
    noStore();
    const actor = optionalActor();
    if (!actor) {
      return { claimed: false, day: null, openedToday: false, secretsOwned: 0, resetsAt: null };
    }
    const { data, error } = await (
      await rpc()
    ).rpc("pack_status", {
      _participant_id: sqlNull(actor.kind === "member" ? actor.id : null),
      _guest_id: sqlNull(actor.kind === "guest" ? actor.id : null),
    });
    if (error) throw new Error(error.message);
    const status = data as PackStatusResult;
    return { claimed: true, ...status };
  },
);
