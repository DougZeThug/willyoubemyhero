import { createServerFn } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { optionalActor, requireActor } from "./require-auth.server";
import { signSecretCard } from "./secret-cards.functions";
import type { SecretCardRow, SecretPullRow, PackOpenRow } from "./secret-cards-rows";
import type { ClaimStreakMilestoneResult, StreakClaimRow } from "./streaks-rows";
import type { SecretCardView } from "./secret-cards";
import type { SecretTier } from "./secret-rarity";
import {
  STREAK_MILESTONES,
  STREAK_RESET_MILESTONE,
  isStreakMilestone,
  streakMilestone,
  walkStreak,
  type Streak,
} from "./streaks";

import { leagueDay } from "./trades";
import { sqlNull } from "./rpc-null";

/**
 * Streaks, and the milestones they pay out.
 *
 * Read by anybody — a guest builds a real streak on a server-minted `g.` token —
 * but cashed only by somebody with an account. That gate is not politeness: a
 * milestone buys a permanent collection card, and a device-local guest token is
 * one cleared browser away from taking it with them. `claim_streak_milestone`
 * enforces it a second time in SQL, because a check that lives only here is one
 * future caller away from not existing.
 *
 * The identity is never read from a payload in either direction. There is no
 * parameter for it, which is the same reason secret-cards.functions.ts has none.
 */

/** Typed client, for tables the generated types already know about. */
async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function noStore() {
  setResponseHeader("Cache-Control", "private, no-store");
}

export type StreakMilestoneStatus = {
  days: number;
  label: string;
  blurb: string;
  /** The worst this rung may roll, for the line that says so. Null on day 3. */
  tierFloor: SecretTier | null;
  earned: boolean;
  claimed: boolean;
};

export type StreakStatus = Streak & {
  /** Null before either token has hydrated, which is a blank pill and not an error. */
  kind: "member" | "guest" | null;
  /** The league day this was computed against, so the client never has to guess. */
  today: string;
  /** Whether this actor may cash a milestone at all. False until they sign in. */
  canClaim: boolean;
  milestones: StreakMilestoneStatus[];
};

const NO_STREAK: StreakStatus = {
  kind: null,
  current: 0,
  startedOn: null,
  lastOpenedOn: null,
  openedToday: false,
  today: "",
  canClaim: false,
  milestones: STREAK_MILESTONES.map((m) => ({
    days: m.days,
    label: m.label,
    blurb: m.blurb,
    tierFloor: m.tierFloor,
    earned: false,
    claimed: false,
  })),
};

/**
 * How long this device's streak is, and what it has already cashed.
 *
 * `optionalActor` rather than `requireActor`, matching getSecretStatus: a device
 * with no identity yet — or one whose token expired overnight — has a streak of
 * zero, which is a fact and not an error. Throwing here would put the hook on its
 * error path and blank the pill on the very first paint of the pack screen.
 */
export const getStreakStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<StreakStatus> => {
    noStore();
    const actor = optionalActor();
    const today = leagueDay();
    if (!actor) return { ...NO_STREAK, today };

    const sb = await admin();
    // One column per actor kind rather than an `.or()` filter: PostgREST would
    // take the or, but it is not a thing the test double models, and a query
    // whose only coverage is production is not covered.
    const { data: opens, error } = await sb
      .from("pack_opens")
      .select("opened_on")
      .eq(actor.kind === "member" ? "participant_id" : "guest_id", actor.id)
      .order("opened_on", { ascending: true })
      .returns<Pick<PackOpenRow, "opened_on">[]>();
    if (error) throw error;

    const streaks = await admin();
    const { data: claims, error: claimError } = await streaks
      .from("streak_milestone_claims")
      .select("milestone, streak_started_on, claimed_on")
      .eq(actor.kind === "member" ? "participant_id" : "guest_id", actor.id)
      .returns<{ milestone: number; streak_started_on: string; claimed_on: string }[]>();
    if (claimError) throw claimError;

    // The day the capstone was last cashed, which is where the walk restarts.
    // Read before the walk rather than after it, because the walk depends on it:
    // streak_runs does the same cut in SQL, and a screen that disagreed with the
    // payout would offer a rung the server then refuses.
    const resetOn =
      (claims ?? [])
        .filter((c) => c.milestone === STREAK_RESET_MILESTONE)
        .map((c) => c.claimed_on)
        .sort()
        .at(-1) ?? null;

    const streak = walkStreak(
      (opens ?? []).map((r) => r.opened_on),
      today,
      resetOn,
    );

    const sbAdmin = await admin();
    // An existence check, deliberately not maybeSingle(): account_identities
    // indexes participant_id and guest_id NON-uniquely, so two accounts adopting
    // the same identity is a state the schema permits. maybeSingle() answers
    // that with an error and a null row, which would pin canClaim to false for
    // exactly the people claim_streak_milestone's own `PERFORM 1 … IF NOT FOUND`
    // gate lets through — a button that never appears for a claim the server
    // would authorise. The error is rethrown rather than swallowed for the same
    // reason: a silent false here is indistinguishable from "no account".
    const { data: accounts, error: accountError } = await sbAdmin
      .from("account_identities")
      .select("user_id")
      .eq(actor.kind === "member" ? "participant_id" : "guest_id", actor.id)
      .limit(1);
    if (accountError) throw accountError;

    // A claim counts against this run when its start date falls anywhere inside
    // it — the same window claim_streak_milestone checks. Matching on the start
    // date alone would re-arm a paid milestone the moment a guest history merged
    // in and moved the run's first day backwards.
    const claimed = new Set(
      (claims ?? [])
        .filter(
          (c) =>
            streak.startedOn !== null &&
            streak.lastOpenedOn !== null &&
            c.streak_started_on >= streak.startedOn &&
            c.streak_started_on <= streak.lastOpenedOn,
        )
        .map((c) => c.milestone),
    );

    return {
      ...streak,
      kind: actor.kind,
      today,
      canClaim: (accounts ?? []).length > 0,
      milestones: STREAK_MILESTONES.map((m) => ({
        days: m.days,
        label: m.label,
        blurb: m.blurb,
        tierFloor: m.tierFloor,
        earned: streak.current >= m.days,
        claimed: claimed.has(m.days),
      })),
    };
  },
);

/**
 * Cash one milestone.
 *
 * `requireActor` rather than `requireMember`: a guest with an account has a real
 * streak and a real reward waiting. Whether they may actually take it is decided
 * by the RPC against `account_identities`, not here — and the id it is decided
 * against comes off the verified token, never the payload.
 */
export const claimStreakMilestone = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        milestone: z.number().int().refine(isStreakMilestone, { message: "Unknown milestone" }),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const actor = requireActor();
    noStore();
    const sb = await admin();

    // Stamped on the claim for flavour only, and resolved here rather than taken
    // from the payload. A streak out of season is fine.
    const { data: event } = await sb
      .from("events")
      .select("id")
      .eq("active", true)
      .order("year", { ascending: false })
      .limit(1)
      .maybeSingle();

    const streaks = await admin();
    const { data: raw, error } = await streaks.rpc("claim_streak_milestone", {
      _participant_id: sqlNull(actor.kind === "member" ? actor.id : null),
      _guest_id: sqlNull(actor.kind === "guest" ? actor.id : null),
      _milestone: data.milestone,
      _event_id: sqlNull(event?.id ?? null),
    });
    if (error) throw new Error(error.message);

    const result = raw as ClaimStreakMilestoneResult;
    // Every soft failure is passed through as a reason rather than thrown: all of
    // them are something to say on the button, and none of them is an error
    // anybody can act on by retrying differently.
    if (!result?.ok) {
      return { ok: false as const, reason: result?.reason ?? ("unavailable" as const) };
    }

    const sbSecrets = await admin();
    const { data: card } = await sbSecrets
      .from("secret_cards")
      .select("*")
      .eq("id", result.reward.cardId)
      .maybeSingle<SecretCardRow>();
    // The payout landed in Postgres either way; only the picture is missing. Say
    // so softly rather than throwing away a claim that has already been spent.
    if (!card) return { ok: false as const, reason: "unavailable" as const };

    return {
      ok: true as const,
      milestone: result.milestone,
      streak: result.streak,
      startedOn: result.startedOn,
      duplicate: result.reward.duplicate,
      card: await signSecretCard(card, result.reward.tier),
    };
  });

/** One rung, cashed: which it was, when, and what came out of the wrapper. */
export type StreakHistoryEntry = {
  /** The rung, as stored. A rung this deploy no longer lists still renders. */
  milestone: number;
  /** Null when the rung has been retired since it was cashed. */
  label: string | null;
  claimedOn: string;
  /** Which run paid it, so two claims of the same rung are tellable apart. */
  streakStartedOn: string;
  /** Null when the payout was not a secret, or its pull has since gone. */
  card: SecretCardView | null;
};

/** Enough to see the shape of a habit; not enough to walk somebody's whole ledger. */
const HISTORY_LIMIT = 20;

/**
 * Every milestone this actor has ever cashed, and the card each one paid.
 *
 * Separate from `getStreakStatus` rather than folded into it, for two reasons.
 * That read answers a question about the RUN you are on — its `claimed` flags are
 * scoped to the current `streak_started_on` window and go false the day a run
 * breaks — and it is asked from the nav, the vault and the pack screen on every
 * focus. This one outlives every run, and it is asked from one screen somebody
 * has deliberately opened.
 *
 * `optionalActor` for the same reason its neighbour uses it: a device with no
 * identity has claimed nothing, which is an empty list and not an error.
 *
 * The set-size rule holds by construction. Every card here came out of THIS
 * actor's own claim rows, and each is signed by `signSecretCard` — the same view
 * `getMySecrets` returns — so there is no denominator to leak, and no id from a
 * request anywhere in the path.
 */
export const getStreakHistory = createServerFn({ method: "GET" }).handler(
  async (): Promise<StreakHistoryEntry[]> => {
    noStore();
    const actor = optionalActor();
    if (!actor) return [];

    const sb = await admin();
    // One column per actor kind rather than an `.or()` filter, same as the walk
    // above: PostgREST would take the or, but the test double does not model it,
    // and a query whose only coverage is production is not covered.
    const { data: claims, error } = await sb
      .from("streak_milestone_claims")
      .select("milestone, streak_started_on, claimed_on, reward_ref, reward_tier")
      .eq(actor.kind === "member" ? "participant_id" : "guest_id", actor.id)
      .order("claimed_on", { ascending: false })
      .limit(HISTORY_LIMIT)
      .returns<Pick<StreakClaimRow, "milestone" | "streak_started_on" | "claimed_on" | "reward_ref" | "reward_tier">[]>(); // prettier-ignore
    if (error) throw error;

    const rows = claims ?? [];
    // Two hops rather than an embed: reward_ref deliberately carries no foreign
    // key — a pull moves between identities when a guest claims, so the column is
    // a receipt and not a live reference — and PostgREST can only embed across
    // one. The `.in(...)` on ids this actor's own rows named is what keeps the
    // second hop from being a read of the whole ledger.
    const refs = [...new Set(rows.map((r) => r.reward_ref).filter((v): v is string => !!v))];
    const pulls = refs.length
      ? ((
          await sb
            .from("secret_card_pulls")
            .select("id, secret_card_id, tier")
            .in("id", refs)
            .returns<Pick<SecretPullRow, "id" | "secret_card_id" | "tier">[]>()
        ).data ?? [])
      : [];

    const cardIds = [...new Set(pulls.map((p) => p.secret_card_id))];
    const cards = cardIds.length
      ? ((await sb.from("secret_cards").select("*").in("id", cardIds).returns<SecretCardRow[]>())
          .data ?? [])
      : [];

    const pullById = new Map(pulls.map((p) => [p.id, p]));
    const cardById = new Map(cards.map((c) => [c.id, c]));
    // Keyed on the card AND the level, never the card alone. The level belongs to
    // the PULL — every copy rolls its own — and signSecretCard bakes it into the
    // view, so two rungs paid by two copies of one card would both have worn the
    // first one's word and pips. Same card at the same level is genuinely the
    // same view, which is where the round trip signPath costs is still saved.
    const signed = new Map<string, SecretCardView>();
    const viewKey = (cardId: string, tier: string) => `${cardId}:${tier}`;

    const out: StreakHistoryEntry[] = [];
    for (const row of rows) {
      const pull = row.reward_ref ? pullById.get(row.reward_ref) : undefined;
      const card = pull ? cardById.get(pull.secret_card_id) : undefined;
      let view: SecretCardView | null = null;
      if (pull && card) {
        // The claim row's own tier first, and the pull's only as a fallback.
        // This is a receipt — what the rung paid on the day — and a pull's tier
        // is not one: pull_secret_card raises the owning copy in place when a
        // later duplicate rolls better, which is the rule the VAULT wants, since
        // the vault answers "what do I hold". Read straight it meant a mythic
        // pulled in October rewrote what September's rung was shown to have
        // paid, against a claim toast that had said something else. The fallback
        // is for claims made before the column existed and is the same value
        // those rows already rendered — no history moves the day this ships.
        const tier = row.reward_tier ?? pull.tier;
        const key = viewKey(card.id, tier);
        if (!signed.has(key)) signed.set(key, await signSecretCard(card, tier));
        view = signed.get(key) ?? null;
      }
      out.push({
        milestone: row.milestone,
        label: streakMilestone(row.milestone)?.label ?? null,
        claimedOn: row.claimed_on,
        streakStartedOn: row.streak_started_on,
        card: view,
      });
    }
    return out;
  },
);
