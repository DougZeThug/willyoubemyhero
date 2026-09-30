import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { EDITION_IDS } from "./card-edition";
import { requireAdmin, requireMember } from "./require-auth.server";
import type { CardPullRow, PackOpenRow } from "./secret-cards-rows";
import type { CardPullCounts, MyCardStats } from "./card-pulls";
import { uuid as zuuid } from "./zod-uuid";
import { sqlNull } from "./rpc-null";

/*
 * There is no recordCardPulls here any more.
 *
 * It used to sit between getCardPullCounts and adoptCollection and accept the
 * ids of a pack the phone had dealt itself — with a long comment admitting a
 * member could post valid roster ids by hand and be credited them. The pack is
 * dealt in Postgres now (open_pack, via pack.functions.ts), which mints through
 * the same record_card_pulls RPC from inside the transaction that chose the
 * cards. Nothing client-side names a roster id to be minted any more.
 */

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

/** The service-role client, loaded inside the handler so it never reaches the bundle. */
async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/**
 * How many people have packed each card in an event.
 *
 * Unguarded, like getEventSocial: this is a public aggregate about public cards.
 */
export const getCardPullCounts = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ eventId: zuuid() }).parse(d))
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
 * File the cards this phone already holds against the person who just claimed.
 *
 * The gap this closes: a guest's pack tear records nothing at all server-side,
 * so a collection built before claiming lived only in IndexedDB — and the moment
 * a code was redeemed, `mergeCollection` treated `card_pulls` as the truth and
 * `forgetCards` deleted every local row the server could not vouch for. Which was
 * all of them.
 *
 * ONE COPY PER CARD THEY DO NOT ALREADY HOLD, enforced in the RPC rather than
 * here. A local row says "I hold this card", not how many copies of it exist, so
 * trusting a count would mint duplicates. That also makes this idempotent: a
 * second claim on the same handset adopts nothing, which is why the client can
 * call it on every claim without bookkeeping.
 *
 * The one client-asserted write left on this table — a member can name roster
 * ids by hand — and the rule that keeps it tolerable: an adopted copy's
 * finish must never reach a number a second person can see without being
 * re-derived. Copies land with `source = 'adopt'` and no `acquired_on`, so they
 * are distinguishable from pulls forever and never touch the once-a-day index.
 */
export const adoptCollection = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        // A whole roster's worth, since this is a collection rather than a pack.
        eventParticipantIds: z.array(zuuid()).min(1).max(64),
        // NO FINISHES. There used to be an `editions` array beside the ids, and
        // the RPC filed whatever it said. An adopted copy is `edition_asserted_by
        // = 'client'` and pays the flat floor at the mill, but `card_pulls.edition`
        // is derived from the copies, so every screen dressed the card in the
        // phone's word for it — and the marketplace priced it that way. A phone
        // still sending the key is tolerated (zod strips it) and ignored.
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const me = await requireMember();
    const secrets = await db();
    const { data: n, error } = await secrets.rpc("adopt_card_copies", {
      _participant_id: me,
      _event_participant_ids: data.eventParticipantIds,
      // Kept in the call because the RPC's signature keeps it, the same way
      // record_card_pulls keeps its own. Postgres never reads it.
      _editions: sqlNull(null),
    });
    if (error) throw new Error(error.message);
    return { ok: true as const, adopted: (n as number | null) ?? 0 };
  });

/**
 * Commissioner hands a player a card.
 *
 * The repair tool for a collection that was lost before adoption existed, so it
 * deliberately allows a card they already hold. The copy is filed as `grant`,
 * which keeps it out of the once-a-day pull index and honest in the ledger about
 * where it came from.
 *
 * Idempotent per `grantKey`: a retry replays the first answer rather than
 * dealing a second copy. Deliberately handing somebody two copies is still two
 * grants, with two keys.
 */
export const grantCard = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        eventId: zuuid(),
        participantId: zuuid(),
        eventParticipantId: zuuid(),
        edition: z.enum(EDITION_IDS).optional(),
        /**
         * One key per grant the commissioner meant to make, held by the screen
         * across a retry. Without it a request that timed out after committing
         * handed out a real second copy on the next tap, in a game whose whole
         * economy is scarcity.
         */
        grantKey: z.string().min(8).max(64),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await requireAdmin(data.eventId);
    const secrets = await db();
    const { data: res, error } = await secrets.rpc("grant_card_copy_once", {
      _grant_key: data.grantKey,
      _participant_id: data.participantId,
      _event_participant_id: data.eventParticipantId,
      _edition: data.edition ?? "standard",
      // The event the token actually authorizes, carried into the write rather
      // than checked and dropped. Without it the guard above proved only that
      // the caller runs SOME event: the RPC checked that the card and the
      // recipient existed, not that either belonged here, so an admin for this
      // combine could mint a copy of a card from somebody else's — and bump
      // that event's public "packed by" count doing it.
      _event_id: data.eventId,
    });
    if (error) throw new Error(error.message);
    const row = (res ?? {}) as { copies?: number; repeat?: boolean };
    return { ok: true as const, copies: row.copies ?? 0, repeat: !!row.repeat };
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
  .inputValidator((d: unknown) => z.object({ eventId: zuuid() }).parse(d))
  .handler(async ({ data }): Promise<MyCardStats> => {
    const me = await requireMember();
    const sb = await admin();

    // Resolve the event's own cards first and constrain to them, exactly as
    // getCardPullCounts does — so a member's stats can never be used to
    // enumerate another event's roster.
    //
    // The error is checked rather than coalesced away, unlike its counterpart in
    // getCardPullCounts. There a failed read costs a decorative count; here it
    // would come back as "you own nothing", and the caller treats this response as
    // the truth about a member's collection — so an empty one deletes their local
    // rows. Throwing puts the hook on its error path, which keeps the collection.
    const { data: eps, error: epsError } = await sb
      .from("event_participants")
      .select("id")
      .eq("event_id", data.eventId);
    if (epsError) throw epsError;
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
      .select("event_participant_id, pull_count, edition, first_pulled_at")
      .eq("participant_id", me)
      .in("event_participant_id", ids)
      .returns<
        Pick<CardPullRow, "event_participant_id" | "pull_count" | "edition" | "first_pulled_at">[]
      >();
    if (error) throw error;

    return {
      ...base,
      cards: (rows ?? []).map((r) => ({
        eventParticipantId: r.event_participant_id,
        pullCount: r.pull_count,
        // Passed through unvalidated: the column has no CHECK, and card-edition.ts
        // renders anything it does not recognise as standard rather than throwing
        // on the way out of a read.
        edition: r.edition,
        firstPulledAt: r.first_pulled_at,
      })),
    };
  });
