// The commissioner's write surface.
//
// EVERY WRITE HERE IS SCOPED TO THE EVENT THE TOKEN AUTHORIZES. requireAdmin
// (eventId) proves admin of event A and nothing more, and row ids arrive in the
// payload — so a write matched on the primary key alone would let an admin for A
// edit a station, run or roster row belonging to event B. That is the principle
// deleteComment states in social.functions.ts, applied here: an
// `.eq("event_id", ...)` alongside every `.eq("id", ...)`.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "./require-auth.server";
import { uuid as zuuid } from "./zod-uuid";

/**
 * Stamp the crowd-clock column onto a participant status update.
 *
 * The cast is the only way to write `on_clock_since` today: the column landed
 * in supabase/migrations/20260821120000_on_clock_since.sql but the checked-in
 * generated types have not been regenerated since, the same drift card_rarity
 * already has. Regenerating types.ts makes this a plain object again.
 */
type ParticipantStatusPatch = { participation_status: string };

function withOnClock<T extends ParticipantStatusPatch>(patch: T, since: Date | null) {
  return { ...patch, on_clock_since: since ? since.toISOString() : null } as T;
}

/**
 * Postgres `unique_violation`, as PostgREST reports it.
 *
 * The one error saveCompletedRun retries rather than throws: it means another
 * save took the attempt number between this one's read and its write.
 */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: string }).code === "23505"
  );
}

// ---------- Participants (global) ----------
export const upsertParticipant = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        eventId: zuuid(),
        id: zuuid().optional(),
        name: z.string().min(1).max(80),
        nickname: z.string().max(80).optional().nullable(),
        fantasy_team_name: z.string().max(80).optional().nullable(),
        trash_talk_quote: z.string().max(240).optional().nullable(),
        bio: z.string().max(400).optional().nullable(),
        profile_image_url: z.string().url().optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await requireAdmin(data.eventId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { eventId: _e, id, ...rest } = data;
    if (id) {
      const { data: row, error } = await supabaseAdmin
        .from("participants")
        .update(rest)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return row;
    }
    const { data: row, error } = await supabaseAdmin
      .from("participants")
      .insert(rest)
      .select()
      .single();
    if (error) throw error;
    return row;
  });

export const addParticipantToEvent = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        eventId: zuuid(),
        participantId: zuuid(),
        bib_number: z.number().int().optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await requireAdmin(data.eventId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: max } = await supabaseAdmin
      .from("event_participants")
      .select("running_order")
      .eq("event_id", data.eventId)
      .order("running_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextOrder = (max?.running_order ?? 0) + 1;
    const { error } = await supabaseAdmin.from("event_participants").insert({
      event_id: data.eventId,
      participant_id: data.participantId,
      bib_number: data.bib_number ?? null,
      running_order: nextOrder,
    });
    if (error) throw error;
    return { ok: true };
  });

export const removeParticipantFromEvent = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ eventId: zuuid(), eventParticipantId: zuuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    await requireAdmin(data.eventId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("event_participants")
      .delete()
      .eq("id", data.eventParticipantId)
      .eq("event_id", data.eventId);
    if (error) throw error;
    return { ok: true };
  });

export const setParticipantStatus = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        eventId: zuuid(),
        eventParticipantId: zuuid(),
        status: z.string(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await requireAdmin(data.eventId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Putting somebody on the clock and then starting their run both write
    // "running". Re-stamping on the second one would drag the spectator clock
    // forward to the Start tap and lose the moment they actually stepped up, so
    // an athlete already on the clock keeps the stamp they were given.
    const { data: current } = await supabaseAdmin
      .from("event_participants")
      .select("participation_status")
      .eq("id", data.eventParticipantId)
      .eq("event_id", data.eventId)
      .maybeSingle();
    const alreadyOnClock = current?.participation_status === "running";

    const patch =
      data.status === "running"
        ? alreadyOnClock
          ? { participation_status: data.status }
          : withOnClock({ participation_status: data.status }, new Date())
        : withOnClock({ participation_status: data.status }, null);

    const { error } = await supabaseAdmin
      .from("event_participants")
      .update(patch)
      .eq("id", data.eventParticipantId)
      .eq("event_id", data.eventId);
    if (error) throw error;
    return { ok: true };
  });

/**
 * Clear the combine back to "not started yet": every run for the event goes,
 * and everybody on the roster returns to `waiting`. Scratched athletes stay
 * scratched — being out of the field is a roster decision, not a result.
 */
export const resetCombine = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ eventId: zuuid() }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin(data.eventId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: runs } = await supabaseAdmin
      .from("runs")
      .select("id")
      .eq("event_id", data.eventId);
    const runIds = (runs ?? []).map((r) => r.id);
    if (runIds.length) {
      await supabaseAdmin.from("penalties").delete().in("run_id", runIds);
      await supabaseAdmin.from("splits").delete().in("run_id", runIds);
      const { error } = await supabaseAdmin.from("runs").delete().in("id", runIds);
      if (error) throw error;
    }
    const { error: statusError } = await supabaseAdmin
      .from("event_participants")
      .update(withOnClock({ participation_status: "waiting" }, null))
      .eq("event_id", data.eventId)
      .neq("participation_status", "scratched");
    if (statusError) throw statusError;
    return { ok: true, clearedRuns: runIds.length };
  });

// ---------- Running order ----------
export const setRunningOrder = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        eventId: zuuid(),
        order: z.array(z.object({ id: zuuid(), running_order: z.number().int() })),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await requireAdmin(data.eventId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Bulk update in parallel
    await Promise.all(
      data.order.map((row) =>
        supabaseAdmin
          .from("event_participants")
          .update({ running_order: row.running_order })
          .eq("id", row.id)
          .eq("event_id", data.eventId),
      ),
    );
    return { ok: true };
  });

export const recordRandomization = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        eventId: zuuid(),
        scope: z.string(),
        // Two snapshots of a running order, so they are roster-sized. Untyped
        // and stored as jsonb, which is exactly why they need a length: nothing
        // downstream would notice a million entries until the row was written.
        previous: z.array(z.any()).max(64),
        resulting: z.array(z.any()).max(64),
        seed: z.string(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await requireAdmin(data.eventId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("running_order_randomizations").insert({
      event_id: data.eventId,
      randomized_scope: data.scope,
      previous_order: data.previous,
      resulting_order: data.resulting,
      randomization_seed: data.seed,
      randomized_by: "admin",
    });
    return { ok: true };
  });

// ---------- Stations ----------
export const upsertStation = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        eventId: zuuid(),
        id: zuuid().optional(),
        name: z.string().min(1).max(80),
        short_name: z.string().max(20).optional().nullable(),
        description: z.string().max(400).optional().nullable(),
        station_order: z.number().int(),
        icon: z.string().max(40).optional().nullable(),
        split_enabled: z.boolean(),
        penalty_amount_ms: z.number().int().nonnegative(),
        active: z.boolean(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await requireAdmin(data.eventId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { eventId, id, ...rest } = data;
    if (id) {
      const { error } = await supabaseAdmin
        .from("stations")
        .update(rest)
        .eq("id", id)
        .eq("event_id", eventId);
      if (error) throw error;
    } else {
      const { error } = await supabaseAdmin.from("stations").insert({ ...rest, event_id: eventId });
      if (error) throw error;
    }
    return { ok: true };
  });

export const deleteStation = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ eventId: zuuid(), id: zuuid() }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin(data.eventId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("stations")
      .delete()
      .eq("id", data.id)
      .eq("event_id", data.eventId);
    if (error) throw error;
    return { ok: true };
  });

// ---------- Runs ----------
export const saveCompletedRun = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        eventId: zuuid(),
        participantId: zuuid(),
        clientKey: z.string().min(8),
        started_at: z.string(),
        finished_at: z.string(),
        raw_time_ms: z.number().int().nonnegative(),
        paused_duration_ms: z.number().int().nonnegative().default(0),
        splits: z
          .array(
            z.object({
              stationId: zuuid(),
              cumulative_time_ms: z.number().int().nonnegative(),
              segment_time_ms: z.number().int().nonnegative().nullable(),
              clientKey: z.string(),
              recorded_at: z.string(),
            }),
          )
          .default([]),
        penalties: z
          .array(
            z.object({
              stationId: zuuid().nullable(),
              penalty_ms: z.number().int(),
              reason: z.string().nullable(),
              clientKey: z.string(),
            }),
          )
          .default([]),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await requireAdmin(data.eventId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // `participantId` is a global id, so an admin for this event could otherwise
    // file a run against somebody who only ever ran a different one.
    const { data: onRoster, error: rosterError } = await supabaseAdmin
      .from("event_participants")
      .select("id")
      .eq("event_id", data.eventId)
      .eq("participant_id", data.participantId)
      .maybeSingle();
    if (rosterError) throw rosterError;
    if (!onRoster) throw new Error("Participant does not belong to this event");

    // A retry of a save that already landed must keep the number it was given:
    // recomputing would renumber a first run as attempt 2. Matching on client_key
    // rather than excluding it from a count keeps this NULL-safe — client_key is
    // nullable and Postgres `<>` drops NULL rows.
    const { data: alreadySaved } = await supabaseAdmin
      .from("runs")
      .select("attempt_number")
      .eq("client_key", data.clientKey)
      .eq("event_id", data.eventId)
      .maybeSingle();

    // The highest number in use, not how many rows there are. A count renumbers
    // downwards after a deleteRun: delete attempt 1 of two and the next save
    // computes 2, which is taken. That was a silent duplicate before
    // 20260822120000 added the unique index, and would be a refused save after it.
    const nextAttempt = async () => {
      const { data: highest } = await supabaseAdmin
        .from("runs")
        .select("attempt_number")
        .eq("event_id", data.eventId)
        .eq("participant_id", data.participantId)
        .order("attempt_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      return (highest?.attempt_number ?? 0) + 1;
    };

    const penaltyTotal = data.penalties.reduce((s, p) => s + p.penalty_ms, 0);

    const saveRun = (attemptNumber: number) =>
      supabaseAdmin
        .from("runs")
        .upsert(
          {
            event_id: data.eventId,
            participant_id: data.participantId,
            attempt_number: attemptNumber,
            started_at: data.started_at,
            finished_at: data.finished_at,
            raw_time_ms: data.raw_time_ms,
            paused_duration_ms: data.paused_duration_ms,
            penalty_ms: penaltyTotal,
            status: "official",
            is_official: true,
            client_key: data.clientKey,
          },
          { onConflict: "client_key" },
        )
        .select()
        .single();

    let saved = await saveRun(alreadySaved?.attempt_number ?? (await nextAttempt()));
    // Two consoles saving at once read the same highest number and both write it;
    // the unique index refuses the loser. One recomputation is enough to land
    // behind the winner. A second failure is not a race, and losing the run to a
    // thrown error — which leaves the console's local backup intact — beats
    // looping on it. A replay keeps its own number, so it never comes through here.
    if (saved.error && !alreadySaved && isUniqueViolation(saved.error)) {
      saved = await saveRun(await nextAttempt());
    }
    if (saved.error) throw saved.error;
    const run = saved.data;

    if (data.splits.length) {
      // A silent failure here loses the splits for good: the console clears its
      // local backup as soon as this resolves.
      const { error: splitsError } = await supabaseAdmin.from("splits").upsert(
        data.splits.map((s) => ({
          run_id: run.id,
          station_id: s.stationId,
          cumulative_time_ms: s.cumulative_time_ms,
          segment_time_ms: s.segment_time_ms,
          recorded_at: s.recorded_at,
          entry_method: "live_manual",
          client_key: s.clientKey,
        })),
        { onConflict: "client_key" },
      );
      if (splitsError) throw splitsError;
    }
    if (data.penalties.length) {
      const { error: penaltiesError } = await supabaseAdmin.from("penalties").upsert(
        data.penalties.map((p) => ({
          run_id: run.id,
          station_id: p.stationId,
          penalty_ms: p.penalty_ms,
          reason: p.reason,
          client_key: p.clientKey,
        })),
        { onConflict: "client_key" },
      );
      if (penaltiesError) throw penaltiesError;
    }

    // Mark participant finished
    const { error: statusError } = await supabaseAdmin
      .from("event_participants")
      .update(withOnClock({ participation_status: "finished" }, null))
      .eq("event_id", data.eventId)
      .eq("participant_id", data.participantId);
    if (statusError) throw statusError;

    return { runId: run.id };
  });

export const deleteRun = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ eventId: zuuid(), runId: zuuid() }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin(data.eventId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("runs")
      .delete()
      .eq("id", data.runId)
      .eq("event_id", data.eventId);
    if (error) throw error;
    return { ok: true };
  });

// ---------- Draft selections ----------
export const recordDraftSelection = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        eventId: zuuid(),
        participantId: zuuid(),
        draftPosition: z.number().int().positive(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await requireAdmin(data.eventId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { count } = await supabaseAdmin
      .from("draft_selections")
      .select("*", { count: "exact", head: true })
      .eq("event_id", data.eventId);
    const { error } = await supabaseAdmin.from("draft_selections").insert({
      event_id: data.eventId,
      participant_id: data.participantId,
      selection_order: (count ?? 0) + 1,
      draft_position: data.draftPosition,
    });
    if (error) throw error;
    await supabaseAdmin
      .from("event_participants")
      .update({ selected_draft_position: data.draftPosition })
      .eq("event_id", data.eventId)
      .eq("participant_id", data.participantId);
    return { ok: true };
  });

export const undoLastDraftSelection = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ eventId: zuuid() }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin(data.eventId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: last } = await supabaseAdmin
      .from("draft_selections")
      .select("*")
      .eq("event_id", data.eventId)
      .order("selection_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!last) return { ok: true };
    await supabaseAdmin.from("draft_selections").delete().eq("id", last.id);
    await supabaseAdmin
      .from("event_participants")
      .update({ selected_draft_position: null })
      .eq("event_id", data.eventId)
      .eq("participant_id", last.participant_id);
    return { ok: true };
  });

// ---------- Event ----------
export const updateEvent = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        eventId: zuuid(),
        status: z.string().optional(),
        results_locked: z.boolean().optional(),
        draft_locked: z.boolean().optional(),
        running_order_locked: z.boolean().optional(),
        splits_enabled: z.boolean().optional(),
        timing_mode: z.string().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await requireAdmin(data.eventId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { eventId, ...rest } = data;
    const { error } = await supabaseAdmin.from("events").update(rest).eq("id", eventId);
    if (error) throw error;
    return { ok: true };
  });
