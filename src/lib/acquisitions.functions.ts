import { createServerFn } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireMember } from "./require-auth.server";
import { signPath } from "./media.functions";
import { VARIANT_WIDTHS } from "./media";
import type { CardCopyRow } from "./trades-rows";
import type { SecretCardRow, SecretPullRow } from "./secret-cards-rows";
import { toSecretTier, type SecretTier } from "./secret-rarity";
import { uuid as zuuid } from "./zod-uuid";

/**
 * What arrived since you last looked.
 *
 * The vault could always say what you own and never what is NEW (§12 of
 * docs/ux-audit-mobile.md). A device-stored last-visit timestamp is only half the
 * answer: every client-facing response carries aggregates only — MyCardStats has a
 * count and a best edition, OwnedSecret a count and a first-pull date — so a second
 * copy that arrived by trade, grant or purchase has no timestamp and no source to
 * place it in time. This is the other half, and nothing but a read.
 *
 * THE INVARIANT FROM secret-cards.functions.ts APPLIES HERE TOO, because this is
 * the second file in the app that can mint a secret card's signed URL: no
 * parameter names a card and no parameter names a person. The secret ids signed
 * below come out of this member's own ledger and nowhere else, so there is nothing
 * to smuggle in a payload. If that ever stops being true, it needs a threat model
 * first and not a filter.
 *
 * NO SET SIZE, NO DENOMINATOR, NO COUNT OF ANY KIND crosses this wire. The "×N"
 * the strip draws is computed on the client from data it already holds — the
 * copies in its own collection, the `count` on its own OwnedSecret — which is
 * exactly what §12 prescribes and is why acquisitions.functions.test.ts asserts the
 * response's keys exactly rather than merely spot-checking them.
 */

/** The service-role client, loaded inside the handler so it never reaches the bundle. */
async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/**
 * Resolved once and handed down, rather than re-imported inside each reader.
 *
 * getMySecrets takes the same shape and it is not only tidiness: two dynamic
 * imports of the same module racing inside one Promise.all is a real hazard under
 * the test runner, where one of the pair can win before the module mock is in
 * place and quietly talk to a live database. One client, resolved before anything
 * forks, cannot.
 */
type Admin = Awaited<ReturnType<typeof admin>>;

/**
 * Personalised by a request header, so a shared cache hit would hand one member
 * another's arrivals. Same reasoning as the streak and trade reads, and its own
 * copy for the same reason theirs are: nobody has wanted this in a shared module
 * badly enough to make one.
 */
function noStore() {
  setResponseHeader("Cache-Control", "private, no-store");
}

/** Newest first, and never more of them than a strip could ever show. */
const MAX_ROWS = 50;

/** The furthest back this will look, whatever it is asked for. See `windowFrom`. */
const MAX_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * The window actually queried, clamped into the last day.
 *
 * The client asks for a day and no more, but the client is not what enforces it:
 * `since` arrives in a request, and a member who edits one gets their whole
 * history back instead of a strip. It is their own data either way, so this is a
 * bound on the work rather than a leak — but an unbounded scan of every copy
 * somebody has ever held is not a thing a read this small should be able to do.
 *
 * Clamped rather than rejected, deliberately. A phone with a skewed clock sends a
 * window from tomorrow, and refusing it would blank the strip with an error on the
 * one device that cannot tell why; clamping answers honestly with what is inside
 * the real day.
 */
function windowFrom(since: string, now = Date.now()): string {
  const asked = Date.parse(since);
  const floor = now - MAX_WINDOW_MS;
  if (Number.isNaN(asked)) return new Date(floor).toISOString();
  return new Date(Math.min(Math.max(asked, floor), now)).toISOString();
}

export type RosterAcquisition = {
  eventParticipantId: string;
  /** The finish on THIS copy, not the best one held. */
  edition: string;
  /** pull · trade · grant · market · adopt · backfill. */
  source: string;
  /**
   * The league day this copy was minted on, or null.
   *
   * Null is the normal state for anything that did not come out of a pack: every
   * hand-over path clears it so a re-parented copy cannot collide with
   * card_copies_one_pull_per_day. Kept on the row because it is the honest date to
   * print for a pulled card; never used to order or filter — see below.
   */
  acquiredOn: string | null;
  /**
   * When this copy entered THIS member's collection.
   *
   * Restarted on every hand-over by the trigger 20260905120000 installs, so a card
   * pulled in July and traded over this morning reads this morning — which
   * `created_at`, the mint, does not.
   */
  acquiredAt: string;
};

export type SecretAcquisition = {
  id: string;
  name: string;
  artUrl: string | null;
  tier: SecretTier;
  /** A second copy of one you already had, which is what makes it a "×N". */
  duplicate: boolean;
  acquiredAt: string;
};

export type RecentAcquisitions = {
  roster: RosterAcquisition[];
  secrets: SecretAcquisition[];
};

/**
 * Everything this member acquired at or after `since`.
 *
 * MEMBERS ONLY, deliberately, where the secret shelves below the strip follow the
 * actor and serve guests too. card_copies.participant_id is NOT NULL — a guest has
 * no roster collection to be new about — so half of this answer cannot exist for
 * them, and a strip that could only ever show the other half is worse than no
 * strip. requireMember() first, before anything reads or writes a header.
 *
 * THE WINDOW IS acquired_at, and neither of the two columns that look like it
 * would have done. `acquired_on` is a date that every hand-over path NULLs, so a
 * traded, bought or granted copy has none — precisely the population §12 says the
 * strip exists for. `created_at` is the MINT time and survives a hand-over
 * untouched, because accept_trade_offer and buy_market_listing RE-PARENT the
 * existing row rather than writing a new one, so a card pulled in July and traded
 * to you this morning still reads July. 20260905120000 adds the column that means
 * what this needs, and a trigger restarts it on every change of owner.
 */
export const getRecentAcquisitions = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) =>
    z.object({ eventId: zuuid(), since: z.string().datetime() }).parse(d),
  )
  .handler(async ({ data }): Promise<RecentAcquisitions> => {
    const participantId = await requireMember();
    noStore();
    const sb = await admin();

    // card_copies carries no event_id, so the combine is resolved through the
    // event_participants it points at. Two queries rather than a PostgREST
    // embedded `!inner` filter, for the reason streaks.functions.ts gives about
    // `.or()`: the embed is not modelled by the test double, and a query whose
    // only coverage is production is not covered. Without this scope, a copy from
    // last year's combine arrives in this year's strip as news.
    const { data: eps, error: epError } = await sb
      .from("event_participants")
      .select("id")
      .eq("event_id", data.eventId)
      .returns<{ id: string }[]>();
    if (epError) throw epError;
    const epIds = (eps ?? []).map((r) => r.id);

    const since = windowFrom(data.since);
    const [roster, secrets] = await Promise.all([
      recentCopies(sb, participantId, epIds, since),
      recentSecrets(sb, participantId, since),
    ]);

    // Merged, sorted and cut once, then split back apart. The cap has to be over
    // the ANSWER rather than over either query — fifty of one kind must not push
    // the other kind off the strip entirely — and sorting HERE rather than
    // leaning on each query's `.order(...)` is what makes newest-first a promise
    // this function keeps rather than one it inherits.
    const merged = [...roster, ...secrets]
      .sort((a, b) => b.acquiredAt.localeCompare(a.acquiredAt))
      .slice(0, MAX_ROWS);
    return {
      roster: merged.filter((r): r is RosterAcquisition => "eventParticipantId" in r),
      secrets: merged.filter((s): s is SecretAcquisition => !("eventParticipantId" in s)),
    };
  });

/** Roster copies that landed in the window, for this member and this combine. */
async function recentCopies(
  sb: Admin,
  participantId: string,
  epIds: readonly string[],
  since: string,
): Promise<RosterAcquisition[]> {
  if (epIds.length === 0) return [];
  const { data, error } = await sb
    .from("card_copies")
    .select("event_participant_id, edition, source, acquired_on, acquired_at")
    .eq("participant_id", participantId)
    .in("event_participant_id", epIds)
    .gte("acquired_at", since)
    .order("acquired_at", { ascending: false })
    .limit(MAX_ROWS)
    .returns<
      Pick<
        CardCopyRow,
        "event_participant_id" | "edition" | "source" | "acquired_on" | "acquired_at"
      >[]
    >();
  if (error) throw error;
  return (data ?? []).map((r) => ({
    eventParticipantId: r.event_participant_id,
    edition: r.edition,
    source: r.source,
    acquiredOn: r.acquired_on,
    acquiredAt: r.acquired_at,
  }));
}

/** Secret pulls that landed in the window, and only the cards behind them. */
async function recentSecrets(
  sb: Admin,
  participantId: string,
  since: string,
): Promise<SecretAcquisition[]> {
  const { data: pulls, error } = await sb
    .from("secret_card_pulls")
    .select("secret_card_id, is_duplicate, tier, acquired_at")
    .eq("participant_id", participantId)
    .gte("acquired_at", since)
    .order("acquired_at", { ascending: false })
    .limit(MAX_ROWS)
    .returns<Pick<SecretPullRow, "secret_card_id" | "is_duplicate" | "tier" | "acquired_at">[]>();
  if (error) throw error;
  if (!pulls?.length) return [];

  const ids = [...new Set(pulls.map((p) => p.secret_card_id))];
  // The `.in(...)` is load-bearing rather than an optimisation, exactly as it is
  // in getMySecrets: without it this reads the whole catalogue and the size of the
  // set is sitting in a local variable one careless return away from the wire.
  const { data: rows, error: cardError } = await sb
    .from("secret_cards")
    .select("*")
    .in("id", ids)
    .returns<SecretCardRow[]>();
  if (cardError) throw cardError;
  const byId = new Map((rows ?? []).map((r) => [r.id, r]));

  const out = await Promise.all(
    pulls.map(async (p) => {
      const row = byId.get(p.secret_card_id);
      if (!row) return null;
      return {
        id: row.id,
        name: row.name,
        // The same width signSecretCard mints at, so this shares the six-hour
        // cache in media.functions.ts rather than minting a second URL for the
        // same bytes. The back is deliberately not signed: the strip never turns
        // a card over.
        artUrl: await signPath(row.art_path, VARIANT_WIDTHS.large),
        // The level belongs to the copy, never to the card row — the rule
        // secret-cards.functions.ts states and the reason `tier` is on the pull.
        tier: toSecretTier(p.tier),
        duplicate: p.is_duplicate,
        acquiredAt: p.acquired_at,
      };
    }),
  );
  return out.filter((s): s is SecretAcquisition => s !== null);
}
