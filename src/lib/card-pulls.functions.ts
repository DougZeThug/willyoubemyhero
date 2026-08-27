import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { EDITION_IDS, toEdition, type Edition } from "./card-edition";
import { optionalGuest, optionalMember, requireAdmin, requireMember } from "./require-auth.server";
import type { CardPullRow, PackOpenRow } from "./secret-cards-db.server";
import type { CardPullCounts, MyCardStats } from "./card-pulls";
import { uuid as zuuid } from "./zod-uuid";

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

/** `event_participants.id` → the finish Postgres derived for this member's copy. */
type CardEditions = Record<string, Edition>;

/**
 * What `record_card_pulls` answers with.
 *
 * Hand-written for the same reason the other RPC shapes are: `Returns: Json` in
 * the generated types can never narrow to this.
 */
type RecordCardPullsResult = { recorded: number; editions: Record<string, string> };

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
 *
 * WHAT THIS DOES NOT VERIFY, deliberately: that the ids are the pack the app
 * actually dealt. Everything derivable server-side is — the participant, the
 * event, the card count, and now the finish — but a member posting valid roster
 * ids by hand can still credit themselves cards and a pack-open for today.
 * Closing that properly means re-deriving the deal, which is seeded partly on the
 * *device's* local date and on the collection it held when it was dealt, neither
 * of which the server knows. Guessing at either would silently drop genuine packs
 * on a timezone edge, a worse failure than the one it prevents.
 *
 * What used to sit here instead was an argument that the ceiling was low — "one
 * phantom pack a day on a stat only they can see". That stopped being true when
 * `card_copies` arrived: its once-a-day index is per CARD, so a posted list of
 * every roster id mints a copy of each, and after the dust ledger every one of
 * those is currency. So the RPC now rations minting per league day instead of
 * relying on the ceiling. See the cap in 20260826120000_server_rolled_editions.
 *
 * THE EDITION IS THE SERVER'S, not a claim to check. `record_card_pulls` derives
 * it from (participant, card, league day) and hands it back, which is why this
 * returns an `editions` map the pack reveal reads. `data.editions` is still
 * accepted so a phone mid-rollout keeps recording, and is passed nowhere: the RPC
 * ignores its own parameter. `adoptCollection` stays client-asserted out of
 * necessity — a guest's packs were sealed on a device id this server never learns
 * — and those copies keep `edition_asserted_by = 'client'`, which is what stops
 * dust paying out on them by edition.
 */
export const recordCardPulls = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        // A pack is three cards. The ceiling is loose enough to survive PACK_SIZE
        // changing and tight enough that nobody can post the roster as one pack.
        eventParticipantIds: z.array(zuuid()).min(1).max(16),
        // ACCEPTED AND IGNORED. Kept in the schema so a phone still holding a
        // bundle from before the server derived finishes keeps validating and
        // keeps recording its packs; nothing reads the value. The one-to-one
        // refine that used to guard this is gone with it — the response is keyed
        // by card now, so there is no positional contract left to misalign.
        editions: z.array(z.enum(EDITION_IDS)).max(16).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const me = optionalMember();
    const secrets = await db();
    const sbEvent = await admin();
    const { data: activeEvent } = await sbEvent
      .from("events")
      .select("id")
      .eq("active", true)
      .order("year", { ascending: false })
      .limit(1)
      .maybeSingle();

    // A guest gets no card rows — card_copies is keyed on a participant — but the
    // pack itself is now recorded against their guest id, so the count survives
    // the claim that moves it (claim_guest_packs).
    if (!me) {
      const guest = optionalGuest();
      if (!guest)
        return { ok: true as const, recorded: 0, packsOpened: 0, editions: {} as CardEditions };
      const { data: guestPacks } = await secrets.rpc("record_pack_open", {
        _participant_id: null,
        _event_id: activeEvent?.id ?? null,
        _card_count: data.eventParticipantIds.length,
        _guest_id: guest,
      });
      return {
        ok: true as const,
        recorded: 0,
        packsOpened: (guestPacks as number | null) ?? 0,
        // A guest gets no card rows, so there is no finish to reveal. The pack
        // shows standards until they claim and adoptCollection files the copies.
        editions: {} as CardEditions,
      };
    }

    const { data: raw, error } = await secrets.rpc("record_card_pulls", {
      _participant_id: me,
      _event_participant_ids: data.eventParticipantIds,
      // Always null. The parameter still exists so an old client's call resolves,
      // and the RPC ignores it either way — passing the claim through would be
      // the client-asserted finish coming back in through the window.
      _editions: null,
    });
    if (error) throw new Error(error.message);

    const result = (raw as RecordCardPullsResult | null) ?? { recorded: 0, editions: {} };
    const recorded = result.recorded ?? 0;

    // toEdition rather than a cast: this crosses a jsonb boundary, and the one
    // rule the rest of the app relies on is that an unrecognised finish renders as
    // standard instead of reaching a component that has no style for it.
    const editions: Record<string, Edition> = {};
    for (const [id, value] of Object.entries(result.editions ?? {})) {
      editions[id] = toEdition(value);
    }

    // The pack open is keyed on the league day, so this is idempotent however many
    // times a reveal re-fires it. Its own errors are swallowed: the cards are
    // already recorded by this point and a counter must not fail a pack.
    //
    // `recorded` rather than the payload length: it is what record_card_pulls
    // actually matched against the roster, so a caller cannot store a card count
    // that never corresponded to real cards.
    const { data: packs } = await secrets.rpc("record_pack_open", {
      _participant_id: me,
      _event_id: activeEvent?.id ?? null,
      _card_count: recorded,
      _guest_id: null,
    });

    return {
      ok: true as const,
      recorded,
      packsOpened: (packs as number | null) ?? 0,
      // Keyed by card, because the RPC collapses duplicates and rations the day's
      // minting — the response has neither the caller's ordering nor its length.
      editions,
    };
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
 * Same client-asserted ceiling as `recordCardPulls` above — a member can name
 * roster ids by hand — and the same rule keeps it there: an adopted copy's
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
        editions: z.array(z.enum(EDITION_IDS)).max(64).optional(),
      })
      .refine(
        (v) => v.editions === undefined || v.editions.length === v.eventParticipantIds.length,
        {
          message: "editions must line up one-to-one with eventParticipantIds",
          path: ["editions"],
        },
      )
      .parse(d),
  )
  .handler(async ({ data }) => {
    const me = await requireMember();
    const secrets = await db();
    const { data: n, error } = await secrets.rpc("adopt_card_copies", {
      _participant_id: me,
      _event_participant_ids: data.eventParticipantIds,
      _editions: data.editions ?? null,
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
