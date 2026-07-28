import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { optionalMember } from "./require-auth.server";
import type { CardPullRow } from "./secret-cards-db.server";
import type { CardPullCounts } from "./card-pulls";

/**
 * Who has packed which roster card.
 *
 * The aggregate is public — every player card is browsable by anyone, so how many
 * people have one gives nothing away. The rows behind it are not: "Alice has
 * never packed Bob" is nobody else's business, which is why `card_pulls` is
 * server-only and this is the only way in.
 */

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Untyped client, for the tables types.ts has not been regenerated for. */
async function db() {
  const { secretsDb } = await import("./secret-cards-db.server");
  return secretsDb();
}

/**
 * How many people have packed each card in an event.
 *
 * Unguarded, like getEventSocial: this is a public aggregate about public cards.
 */
export const getCardPullCounts = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ eventId: z.string().uuid() }).parse(d))
  .handler(async ({ data }): Promise<CardPullCounts> => {
    const sb = await admin();
    // Resolve the event's own cards first and constrain to them, the way
    // getEventSocial does — so this handler can never be used to enumerate
    // another event's roster.
    const { data: eps } = await sb
      .from("event_participants")
      .select("id")
      .eq("event_id", data.eventId);
    const ids = (eps ?? []).map((r) => r.id);
    if (ids.length === 0) return {};

    const secrets = await db();
    // Selecting event_participant_id and nothing else is the leak guard:
    // participant_id must never enter this response, not even in a shape nobody
    // renders.
    const { data: rows, error } = await secrets
      .from("card_pulls")
      .select("event_participant_id")
      .in("event_participant_id", ids)
      .returns<Pick<CardPullRow, "event_participant_id">[]>();
    if (error) throw error;

    // One row per person per card, so counting rows IS counting people. No DISTINCT.
    const counts: CardPullCounts = {};
    for (const row of rows ?? []) {
      counts[row.event_participant_id] = (counts[row.event_participant_id] ?? 0) + 1;
    }
    return counts;
  });

/**
 * Record that these cards were in this member's pack.
 *
 * The one mutating handler in this app that deliberately does not throw when
 * nobody is signed in. An unclaimed guest must still get their three cards, this
 * call is fire-and-forget so a throw would surface as an invisible console error
 * rather than anything a person could act on, and the rule the guard actually
 * exists to enforce still holds: the participant id comes from the verified token
 * and never from the payload. A guest simply writes nothing.
 *
 * `backfill` carries the ids already sitting in this device's IndexedDB the first
 * time a claimed member opens a pack, so cards somebody already owns count from
 * day one instead of reading "packed by nobody" for a fortnight. It is not a
 * separate endpoint and not a separate write path — the composite primary key
 * caps a person at one row per card however they got there, so there is nothing
 * an inflated list could do.
 */
export const recordCardPulls = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        eventParticipantIds: z.array(z.string().uuid()).min(1).max(64),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const me = optionalMember();
    if (!me) return { ok: true as const, recorded: 0 };

    const secrets = await db();
    const { data: n, error } = await secrets.rpc("record_card_pulls", {
      _participant_id: me,
      _event_participant_ids: data.eventParticipantIds,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const, recorded: (n as number | null) ?? 0 };
  });
