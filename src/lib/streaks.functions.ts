import { createServerFn } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { optionalActor, requireActor } from "./require-auth.server";
import { signSecretCard } from "./secret-cards.functions";
import type { SecretCardRow, PackOpenRow } from "./secret-cards-db.server";
import type { ClaimStreakMilestoneResult } from "./streaks-db.server";
import type { SecretCardView } from "./secret-cards";
import type { SecretTier } from "./secret-rarity";
import { STREAK_MILESTONES, isStreakMilestone, walkStreak, type Streak } from "./streaks";
import { leagueDay } from "./trades";

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

/** Untyped client, for the streak table types.ts has not been regenerated for. */
async function db() {
  const { streaksDb } = await import("./streaks-db.server");
  return streaksDb();
}

/** Untyped client again, for pack_opens and secret_cards. */
async function secrets() {
  const { secretsDb } = await import("./secret-cards-db.server");
  return secretsDb();
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

    const sb = await secrets();
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

    const streak = walkStreak(
      (opens ?? []).map((r) => r.opened_on),
      today,
    );

    const streaks = await db();
    const { data: claims, error: claimError } = await streaks
      .from("streak_milestone_claims")
      .select("milestone, streak_started_on")
      .eq(actor.kind === "member" ? "participant_id" : "guest_id", actor.id)
      .returns<{ milestone: number; streak_started_on: string }[]>();
    if (claimError) throw claimError;

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

    const streaks = await db();
    const { data: raw, error } = await streaks.rpc("claim_streak_milestone", {
      _participant_id: actor.kind === "member" ? actor.id : null,
      _guest_id: actor.kind === "guest" ? actor.id : null,
      _milestone: data.milestone,
      _event_id: event?.id ?? null,
    });
    if (error) throw new Error(error.message);

    const result = raw as ClaimStreakMilestoneResult;
    // Every soft failure is passed through as a reason rather than thrown: all of
    // them are something to say on the button, and none of them is an error
    // anybody can act on by retrying differently.
    if (!result?.ok) {
      return { ok: false as const, reason: result?.reason ?? ("unavailable" as const) };
    }

    const sbSecrets = await secrets();
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
