import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { EDITION_IDS } from "./card-edition";
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
 *
 * WHAT THIS DOES NOT VERIFY, deliberately: that the ids are the pack the app
 * actually dealt. Everything derivable server-side now is — the participant, the
 * event, the card count — and the payload is capped at a pack-sized list, but a
 * member posting valid roster ids by hand can still credit themselves cards and a
 * pack-open for today. That was already true of the card half before pack_opens
 * existed, and the ceiling is low: `card_pulls` caps a person at one row per card
 * and `pack_opens` at one row per league day, so the most anyone can manufacture
 * is one phantom pack a day on a stat only they can see.
 *
 * Closing it properly means re-deriving the deal server-side, and the deal is
 * seeded partly on the *device's* local date and on the collection it held at the
 * moment it was dealt — neither of which the server knows. Guessing at either
 * would silently drop genuine packs on a timezone edge, which is a worse failure
 * than the one it prevents for a thirteen-person party.
 *
 * THE EDITION IS CLIENT-ASSERTED, and it weakens the argument above in one
 * specific way. The card ids are a *membership* claim — the ceiling is a phantom
 * pack — but an edition is a *value*, and it is exactly the value a public
 * aggregate would read. So the rule that keeps the ceiling where the paragraph
 * above leaves it: an edition must never enter getCardPullCounts, or any other
 * number a second person can see, without being re-derived server-side first.
 * Everything needed to re-derive it is here except the device's local date —
 * card-edition.ts is pure client-safe TS, the participant comes from the verified
 * token, and the event is resolved below — so this is a deliberate v1 choice
 * rather than a dead end.
 */
export const recordCardPulls = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        // A pack is three cards. The ceiling is loose enough to survive PACK_SIZE
        // changing and tight enough that nobody can post the roster as one pack.
        eventParticipantIds: z.array(z.string().uuid()).min(1).max(16),
        // Optional so a phone still holding a bundle from before editions keeps
        // recording its packs; the RPC defaults those rows to standard.
        editions: z.array(z.enum(EDITION_IDS)).max(16).optional(),
      })
      // The contract is positional — the RPC zips these two arrays — so a length
      // mismatch would not fail, it would quietly file each finish against the
      // wrong card. Rejected rather than truncated for that reason.
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
    const me = optionalMember();
    if (!me) return { ok: true as const, recorded: 0, packsOpened: 0 };

    const secrets = await db();
    const { data: n, error } = await secrets.rpc("record_card_pulls", {
      _participant_id: me,
      _event_participant_ids: data.eventParticipantIds,
      // Null rather than an empty array when absent: unnest() pads a NULL against
      // the ids and every row falls to standard, while an empty array would zip
      // to nothing and drop the pack.
      _editions: data.editions ?? null,
    });
    if (error) throw new Error(error.message);
    const recorded = (n as number | null) ?? 0;

    // Resolved here rather than taken from the caller, the way pullSecretCard
    // does it. It used to be a payload field, which made it both spoofable and
    // racy: the pack screen sends this the moment the wrapper comes off, and on a
    // resumed pack that can be before the event query has answered — so the stamp
    // was null and the participant latch stopped it ever being retried.
    const sb = await admin();
    const { data: event } = await sb
      .from("events")
      .select("id")
      .eq("active", true)
      .order("year", { ascending: false })
      .limit(1)
      .maybeSingle();

    // The pack open is keyed on the league day, so this is idempotent however many
    // times a reveal re-fires it. Its own errors are swallowed: the cards are
    // already recorded by this point and a counter must not fail a pack.
    //
    // `recorded` rather than the payload length: it is what record_card_pulls
    // actually matched against the roster, so a caller cannot store a card count
    // that never corresponded to real cards.
    const { data: packs } = await secrets.rpc("record_pack_open", {
      _participant_id: me,
      _event_id: event?.id ?? null,
      _card_count: recorded,
    });

    return {
      ok: true as const,
      recorded,
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
