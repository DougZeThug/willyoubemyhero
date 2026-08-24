import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "./require-auth.server";
import { uuid as zuuid } from "./zod-uuid";
import { leagueDay } from "./trades";

/**
 * The commissioner's answer to "why can't I see my card in trades?".
 *
 * Everything downstream of the trading post keys off a PARTICIPANT id, while a
 * pack opened before somebody claimed a player is filed against the DEVICE that
 * opened it. Those device-held cards still show in that person's own vault — the
 * vault reads by whichever identity the handset holds — so they look owned and
 * behave unowned, which is the exact shape of every "it's not in my available
 * cards" report. This file makes that split visible and repairable.
 */

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Untyped client for the trading tables types.ts has not been regenerated for. */
async function tradesClient() {
  const { tradesDb } = await import("./trades-db.server");
  return tradesDb();
}

export type OwnershipRow = {
  participantId: string;
  name: string;
  isCollector: boolean;
  /** Claimed a paper code or signed into an account — otherwise no offer can reach them. */
  reachable: boolean;
  secrets: number;
  /** Secrets they could stake right now: everything except today's un-granted pull. */
  tradeableSecrets: number;
  rosterCopies: number;
  /** Copies of cards they hold two or more of — the spares-only rule. */
  tradeableRoster: number;
};

export type StrandedDevice = {
  guestId: string;
  secrets: number;
  packOpens: number;
  firstSeen: string | null;
  lastSeen: string | null;
  /** A signed-in account is attached to this device but has no player of its own. */
  signedIn: boolean;
  /** A few card names, so the commissioner can match it to whoever is complaining. */
  sample: string[];
};

export type OwnershipAudit = {
  players: OwnershipRow[];
  stranded: StrandedDevice[];
};

/** Per-player ownership plus every device holding cards nobody can trade. */
export const getOwnershipAudit = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ eventId: zuuid() }).parse(d))
  .handler(async ({ data }): Promise<OwnershipAudit> => {
    await requireAdmin(data.eventId);
    const sb = await admin();
    const trades = await tradesClient();

    const [{ data: participants }, { data: codes }, { data: accounts }, { data: pulls }] =
      await Promise.all([
        sb.from("participants").select("id, name, is_collector").eq("active", true).order("name"),
        sb.from("member_codes").select("participant_id, claimed_at"),
        sb.from("account_identities").select("participant_id, guest_id"),
        sb
          .from("secret_card_pulls")
          .select("participant_id, guest_id, secret_card_id, granted, pulled_on")
          .returns<
            {
              participant_id: string | null;
              guest_id: string | null;
              secret_card_id: string;
              granted: boolean;
              pulled_on: string;
            }[]
          >(),
      ]);

    const { data: copies } = await trades
      .from("card_copies")
      .select("participant_id, event_participant_id")
      .returns<{ participant_id: string; event_participant_id: string }[]>();

    const { data: packs } = await sb
      .from("pack_opens")
      .select("participant_id, guest_id")
      .returns<{ participant_id: string | null; guest_id: string | null }[]>();

    const today = leagueDay();
    const claimed = new Map((codes ?? []).map((c) => [c.participant_id, c.claimed_at]));
    const linked = new Set(
      (accounts ?? []).map((a) => a.participant_id).filter((id): id is string => !!id),
    );
    const accountGuests = new Set(
      (accounts ?? [])
        .filter((a) => !a.participant_id && a.guest_id)
        .map((a) => a.guest_id as string),
    );

    // Secrets, by owner. A row belongs to a player or to a device, never both.
    const secretsBy = new Map<string, { total: number; tradeable: number }>();
    for (const row of pulls ?? []) {
      const key = row.participant_id ?? `guest:${row.guest_id}`;
      if (!row.participant_id && !row.guest_id) continue;
      const cur = secretsBy.get(key) ?? { total: 0, tradeable: 0 };
      cur.total += 1;
      if (row.granted || row.pulled_on !== today) cur.tradeable += 1;
      secretsBy.set(key, cur);
    }

    // Roster copies per player, and how many of them clear the "keep one" rule.
    const copiesBy = new Map<string, Map<string, number>>();
    for (const row of copies ?? []) {
      const perCard = copiesBy.get(row.participant_id) ?? new Map<string, number>();
      perCard.set(row.event_participant_id, (perCard.get(row.event_participant_id) ?? 0) + 1);
      copiesBy.set(row.participant_id, perCard);
    }

    const players: OwnershipRow[] = (participants ?? []).map((p) => {
      const perCard = copiesBy.get(p.id) ?? new Map<string, number>();
      let rosterCopies = 0;
      let tradeableRoster = 0;
      for (const count of perCard.values()) {
        rosterCopies += count;
        if (count >= 2) tradeableRoster += count;
      }
      const secrets = secretsBy.get(p.id) ?? { total: 0, tradeable: 0 };
      return {
        participantId: p.id,
        name: p.name,
        isCollector: !!p.is_collector,
        reachable: !!claimed.get(p.id) || linked.has(p.id),
        secrets: secrets.total,
        tradeableSecrets: secrets.tradeable,
        rosterCopies,
        tradeableRoster,
      };
    });

    // Device-held rows: the whole point of the panel.
    const strandedIds = [
      ...new Set(
        (pulls ?? [])
          .filter((r) => !r.participant_id && r.guest_id)
          .map((r) => r.guest_id as string),
      ),
    ];
    const packsByGuest = new Map<string, number>();
    for (const row of packs ?? []) {
      if (row.participant_id || !row.guest_id) continue;
      packsByGuest.set(row.guest_id, (packsByGuest.get(row.guest_id) ?? 0) + 1);
    }

    const { data: cardNames } = await sb.from("secret_cards").select("id, name");
    const nameOfCard = new Map((cardNames ?? []).map((c) => [c.id, c.name]));

    const stranded: StrandedDevice[] = strandedIds
      .map((guestId) => {
        const rows = (pulls ?? []).filter((r) => !r.participant_id && r.guest_id === guestId);
        const days = rows.map((r) => r.pulled_on).sort();
        return {
          guestId,
          secrets: rows.length,
          packOpens: packsByGuest.get(guestId) ?? 0,
          firstSeen: days[0] ?? null,
          lastSeen: days[days.length - 1] ?? null,
          signedIn: accountGuests.has(guestId),
          sample: [
            ...new Set(rows.map((r) => nameOfCard.get(r.secret_card_id) ?? "Secret card")),
          ].slice(0, 4),
        };
      })
      .sort((a, b) => b.secrets - a.secrets);

    return { players, stranded };
  });

/**
 * Move a device's cards onto a player.
 *
 * Reuses the same RPCs the sign-in and claim paths call, rather than hand-written
 * SQL: they already know how to fold duplicates in and how not to hand somebody a
 * second daily pull. Also repairs the account link when the device belongs to a
 * signed-in account that never picked a name, so the person stops being invisible
 * as a trade partner.
 */
export const attachDeviceToPlayer = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ eventId: zuuid(), guestId: zuuid(), participantId: zuuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    await requireAdmin(data.eventId);
    const sb = await admin();

    const { data: participant, error: pError } = await sb
      .from("participants")
      .select("id, name")
      .eq("id", data.participantId)
      .maybeSingle();
    if (pError) throw pError;
    if (!participant) throw new Error("No such player");

    const { error: secretsError } = await sb.rpc("claim_guest_secrets", {
      _participant_id: data.participantId,
      _guest_id: data.guestId,
    });
    if (secretsError) throw secretsError;

    const { error: packsError } = await sb.rpc("claim_guest_packs", {
      _participant_id: data.participantId,
      _guest_id: data.guestId,
    });
    if (packsError) throw packsError;

    // Same order everywhere this runs: packs first, then the claims keyed off
    // them, so a rescued guest cannot re-earn milestones they already collected.
    const { streaksDb } = await import("./streaks-db.server");
    const { error: streakError } = await streaksDb().rpc("claim_guest_streak_milestones", {
      _participant_id: data.participantId,
      _guest_id: data.guestId,
    });
    if (streakError) throw streakError;

    // An account sitting on this device with no player of its own would keep
    // acting as a guest on its next visit, re-stranding new pulls.
    const { data: identity } = await sb
      .from("account_identities")
      .select("user_id, participant_id")
      .eq("guest_id", data.guestId)
      .maybeSingle();
    if (identity && !identity.participant_id) {
      const { error } = await sb
        .from("account_identities")
        .update({ participant_id: data.participantId })
        .eq("user_id", identity.user_id);
      if (error) throw error;
    }

    const { count } = await sb
      .from("secret_card_pulls")
      .select("id", { count: "exact", head: true })
      .eq("participant_id", data.participantId);

    return { name: participant.name, secrets: count ?? 0 };
  });
