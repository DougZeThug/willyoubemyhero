import { createServerFn } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireAdmin, requireMember } from "./require-auth.server";
import type {
  BuyBonusPullResult,
  MillCardCopyResult,
  RerollEditionResult,
  SellSecretResult,
} from "./dust-db.server";
import { uuid as zuuid } from "./zod-uuid";

/**
 * Dust: what a spare is worth, and what it buys.
 *
 * MEMBERS ONLY, every handler, and that is a product decision rather than a
 * defensive one — see the header of 20260826130000_dust_ledger.sql. `card_copies`
 * is keyed on a participant, so milling and re-rolling are already unreachable for
 * a guest; a guest balance would be earnable and barely spendable. A guest's
 * streak, packs and secrets all carry across on the claim. Dust starts there.
 *
 * The participant id is never read from a payload. There is no parameter for it
 * on any of these — `requireMember()` returns the one the token was signed for,
 * and every RPC below takes that id as its first argument.
 *
 * NO RESPONSE CARRIES A TOTAL, the same rule the rest of the app keeps: a balance
 * is yours, the prices are constants the client already holds, and nothing here
 * says how big the secret set is or what anybody else has.
 */

/** Untyped client, for the dust tables types.ts has not been regenerated for. */
async function db() {
  const { dustDb } = await import("./dust-db.server");
  return dustDb();
}

function noStore() {
  setResponseHeader("Cache-Control", "private, no-store");
}

/**
 * What you have.
 *
 * `sum(delta)` server-side, never a stored total — see dust_balance. Uncached on
 * purpose: it moves on a dupe, a mill and a purchase, and a stale number on a
 * shop sheet is somebody tapping buy on dust they have already spent.
 */
export const getDustBalance = createServerFn({ method: "GET" }).handler(async () => {
  const me = await requireMember();
  noStore();
  const sb = await db();
  const { data, error } = await sb.rpc("dust_balance", { _participant_id: me });
  if (error) throw new Error(error.message);
  return { balance: (data as number | null) ?? 0 };
});

/**
 * Burn a spare roster copy for dust.
 *
 * Every rule that decides whether this is allowed lives in SQL, under the
 * participant row lock: it has to, because "is this a spare" is a question about
 * a count that two taps can race. This handler's whole job is to prove who is
 * asking.
 */
export const millCardCopy = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ cardCopyId: zuuid() }).parse(d))
  .handler(async ({ data }) => {
    const me = await requireMember();
    noStore();
    const sb = await db();
    const { data: raw, error } = await sb.rpc("mill_card_copy", {
      _participant_id: me,
      _card_copy_id: data.cardCopyId,
    });
    if (error) throw new Error(error.message);
    const result = raw as MillCardCopyResult | null;
    if (!result?.ok) {
      return { ok: false as const, reason: result?.reason ?? ("not_found" as const) };
    }
    return {
      ok: true as const,
      awarded: result.awarded,
      edition: result.edition,
      eventParticipantId: result.eventParticipantId,
      balance: result.balance,
    };
  });

/**
 * Sell a secret copy for dust.
 *
 * Any copy, including your only one — the rule trading already keeps, since no
 * public count rides on a member holding one of a secret. Which is why this
 * takes a `secret_card_pulls` id and has no spare rule to speak of: the one
 * refusal a caller is likely to meet is `too_fresh`, and that is today's own
 * un-granted pull, whose deletion would hand back the daily slot.
 *
 * Same division of labour as the mill above: every rule lives in SQL under the
 * participant row lock, and this handler's whole job is to prove who is asking.
 */
export const sellSecretCard = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ secretPullId: zuuid() }).parse(d))
  .handler(async ({ data }) => {
    const me = await requireMember();
    noStore();
    const sb = await db();
    const { data: raw, error } = await sb.rpc("sell_secret_card", {
      _participant_id: me,
      _secret_pull_id: data.secretPullId,
    });
    if (error) throw new Error(error.message);
    const result = raw as SellSecretResult | null;
    if (!result?.ok) {
      return { ok: false as const, reason: result?.reason ?? ("not_found" as const) };
    }
    return {
      ok: true as const,
      awarded: result.awarded,
      tier: result.tier,
      secretCardId: result.secretCardId,
      balance: result.balance,
    };
  });

/**
 * Buy a secret pull without waiting for tomorrow.
 *
 * `requestId` is minted by the caller, once per tap, and reused if that tap is
 * retried — a lost response on a purchase this size is the worst bug this feature
 * could ship, and nothing else about the call is unique enough to key on, since
 * buying two pulls in a row is perfectly legitimate. The RPC answers a repeat with
 * the pull it already bought rather than a second one.
 *
 * No event id is sent: the RPC resolves the active one itself, the same reason
 * recordCardPulls stopped passing one.
 */
export const buyBonusSecretPull = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ requestId: zuuid() }).parse(d))
  .handler(async ({ data }) => {
    const me = await requireMember();
    noStore();
    const sb = await db();
    const { data: raw, error } = await sb.rpc("buy_bonus_secret_pull", {
      _participant_id: me,
      _event_id: null,
      _request_id: data.requestId,
    });
    if (error) throw new Error(error.message);
    const result = raw as BuyBonusPullResult | null;
    if (!result?.ok) {
      return {
        ok: false as const,
        reason: result?.reason ?? ("unavailable" as const),
        balance: result?.balance,
      };
    }
    return {
      ok: true as const,
      price: result.price,
      balance: result.balance,
      pull: result.pull,
    };
  });

/**
 * Roll a copy's finish again.
 *
 * It can come back worse, and the sheet has to say so before the tap — a best-of
 * would make this a risk-free ratchet and every copy in the league would drift to
 * platinum. Same `requestId` rule as the purchase above.
 */
export const rerollCopyEdition = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ cardCopyId: zuuid(), requestId: zuuid() }).parse(d))
  .handler(async ({ data }) => {
    const me = await requireMember();
    noStore();
    const sb = await db();
    const { data: raw, error } = await sb.rpc("reroll_copy_edition", {
      _participant_id: me,
      _card_copy_id: data.cardCopyId,
      _request_id: data.requestId,
    });
    if (error) throw new Error(error.message);
    const result = raw as RerollEditionResult | null;
    if (!result?.ok) {
      return {
        ok: false as const,
        reason: result?.reason ?? ("not_found" as const),
        balance: result?.balance,
      };
    }
    return {
      ok: true as const,
      price: result.price,
      from: result.from,
      to: result.to,
      eventParticipantId: result.eventParticipantId,
      balance: result.balance,
    };
  });

/**
 * The commissioner's switch for the whole economy.
 *
 * Its own function rather than a field on `updateEvent`: a feature switch reads
 * better owned by the feature than buried among the event's lock flags, and
 * `updateEvent`'s validator already carries a caution about optional booleans
 * nothing ever calls. It goes through this file's untyped shim because the rest
 * of the feature does, not because the column is missing — types.ts has since
 * been regenerated and carries `dust_enabled`.
 *
 * `requireAdmin(eventId)` rather than `requireMember()`, unlike everything else
 * in this file — this is the one dust call a player must never make.
 *
 * Postgres is what actually enforces the switch: every dust RPC calls
 * `dust_enabled()` before it takes a lock, so a client that ignored the flag is
 * still refused. This only decides what the switch says.
 */
export const setDustEnabled = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ eventId: zuuid(), enabled: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin(data.eventId);
    noStore();
    const sb = await db();
    const { error } = await sb
      .from("events")
      .update({ dust_enabled: data.enabled })
      .eq("id", data.eventId);
    if (error) throw new Error(error.message);
    return { ok: true as const, enabled: data.enabled };
  });
