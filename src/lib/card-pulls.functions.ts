import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { optionalMember, requireMember } from "./require-auth.server";
import type { CardPullRow, PackOpenRow } from "./secret-cards-db.server";
import type { CardPullCounts, MyCardStats } from "./card-pulls";

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
 * Tearing a pack also records the pack itself, in the same call. Two writes rather
 * than two endpoints because they describe one event, and because a pack of three
 * cards you already own writes no new `card_pulls` row at all — counting packs
 * from that table would quietly stop counting once somebody's collection filled up.
 */
export const recordCardPulls = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        eventParticipantIds: z.array(z.string().uuid()).min(1).max(64),
        eventId: z.string().uuid().nullish(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const me = optionalMember();
    if (!me) return { ok: true as const, recorded: 0, packsOpened: 0 };

    const secrets = await db();
    const { data: n, error } = await secrets.rpc("record_card_pulls", {
      _participant_id: me,
      _event_participant_ids: data.eventParticipantIds,
    });
    if (error) throw new Error(error.message);

    // The pack open is keyed on the league day, so this is idempotent however many
    // times a reveal re-fires it. Its own errors are swallowed: the cards are
    // already recorded by this point and a counter must not fail a pack.
    const { data: packs } = await secrets.rpc("record_pack_open", {
      _participant_id: me,
      _event_id: data.eventId ?? null,
      _card_count: data.eventParticipantIds.length,
    });

    return {
      ok: true as const,
      recorded: (n as number | null) ?? 0,
      packsOpened: (packs as number | null) ?? 0,
    };
  });

/**
 * Your own pack history: how many packs you have opened, and which cards you hold.
 *
 * `requireMember()` rather than the `optionalMember` its neighbours use — this is
 * the private half of `card_pulls`, so an unclaimed caller gets nothing rather
 * than an empty-looking success. The participant id comes from the verified token
 * and is never accepted from the payload; that is the whole reason this can return
 * rows `getCardPullCounts` is careful never to expose.
 */
export const getMyCardStats = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ eventId: z.string().uuid() }).parse(d))
  .handler(async ({ data }): Promise<MyCardStats> => {
    const me = await requireMember();
    const sb = await admin();

    // Resolve the event's own cards first and constrain to them, exactly as
    // getCardPullCounts does — so a member's stats can never be used to
    // enumerate another event's roster.
    const { data: eps } = await sb
      .from("event_participants")
      .select("id")
      .eq("event_id", data.eventId);
    const ids = (eps ?? []).map((r) => r.id);

    const secrets = await db();
    const { data: opens, error: openError } = await secrets
      .from("pack_opens")
      .select("opened_on")
      .eq("participant_id", me)
      .order("opened_on", { ascending: true })
      .returns<Pick<PackOpenRow, "opened_on">[]>();
    if (openError) throw openError;

    const days = (opens ?? []).map((r) => r.opened_on);
    const base: MyCardStats = {
      packsOpened: days.length,
      firstPackOn: days[0] ?? null,
      lastPackOn: days[days.length - 1] ?? null,
      cards: [],
    };
    if (ids.length === 0) return base;

    const { data: rows, error } = await secrets
      .from("card_pulls")
      .select("event_participant_id, pull_count, first_pulled_at")
      .eq("participant_id", me)
      .in("event_participant_id", ids)
      .returns<Pick<CardPullRow, "event_participant_id" | "pull_count" | "first_pulled_at">[]>();
    if (error) throw error;

    return {
      ...base,
      cards: (rows ?? []).map((r) => ({
        eventParticipantId: r.event_participant_id,
        pullCount: r.pull_count,
        firstPulledAt: r.first_pulled_at,
      })),
    };
  });
