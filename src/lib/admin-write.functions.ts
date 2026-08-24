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

    // A roster row is the parent of every copy of that person's card, with
    // ON DELETE CASCADE all the way down — deleting one wipes the card out of
    // everybody's collection at once, which is exactly how two players' cards
    // disappeared from the league. Once anybody has packed the card, the row is
    // no longer the admin's to delete: it is retired instead.
    const [{ count: copies }, { count: pulls }] = await Promise.all([
      supabaseAdmin
        .from("card_copies")
        .select("id", { count: "exact", head: true })
        .eq("event_participant_id", data.eventParticipantId),
      supabaseAdmin
        .from("card_pulls")
        .select("participant_id", { count: "exact", head: true })
        .eq("event_participant_id", data.eventParticipantId),
    ]);

    if ((copies ?? 0) > 0 || (pulls ?? 0) > 0) {
      const { error: retireError } = await supabaseAdmin
        .from("event_participants")
        .update({ participation_status: "scratched" })
        .eq("id", data.eventParticipantId);
      if (retireError) throw retireError;
      return { ok: true, retained: true } as const;
    }

    const { error } = await supabaseAdmin
      .from("event_participants")
      .delete()
      .eq("id", data.eventParticipantId);
    if (error) throw error;
    return { ok: true, retained: false } as const;
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
      .eq("id", data.eventParticipantId);
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

/**
 * Same idea as a combine reset, scoped to one athlete: their runs (and the
 * splits/penalties hanging off them) go, and they return to `waiting` so the
 * commissioner can re-time them without wiping everybody else's day.
 */
export const resetParticipantRuns = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ eventId: zuuid(), participantId: zuuid() }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin(data.eventId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: runs } = await supabaseAdmin
      .from("runs")
      .select("id")
      .eq("event_id", data.eventId)
      .eq("participant_id", data.participantId);
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
      .eq("participant_id", data.participantId)
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
          .eq("id", row.id),
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
        previous: z.array(z.any()),
        resulting: z.array(z.any()),
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
      const { error } = await supabaseAdmin.from("stations").update(rest).eq("id", id);
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
    const { error } = await supabaseAdmin.from("stations").delete().eq("id", data.id);
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

    // Attempt count. A retry of a save that already landed must keep the number
    // it was given: counting again would include the row this client_key wrote
    // and renumber a first run as attempt 2. Matching on client_key rather than
    // excluding it from the count keeps this NULL-safe — client_key is nullable
    // and Postgres `<>` drops NULL rows.
    const { data: alreadySaved } = await supabaseAdmin
      .from("runs")
      .select("attempt_number")
      .eq("client_key", data.clientKey)
      .maybeSingle();
    const { count } = await supabaseAdmin
      .from("runs")
      .select("*", { count: "exact", head: true })
      .eq("event_id", data.eventId)
      .eq("participant_id", data.participantId);

    const penaltyTotal = data.penalties.reduce((s, p) => s + p.penalty_ms, 0);

    const { data: run, error } = await supabaseAdmin
      .from("runs")
      .upsert(
        {
          event_id: data.eventId,
          participant_id: data.participantId,
          attempt_number: alreadySaved?.attempt_number ?? (count ?? 0) + 1,
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
    if (error) throw error;

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
    const { error } = await supabaseAdmin.from("runs").delete().eq("id", data.runId);
    if (error) throw error;
    return { ok: true };
  });

/**
 * Delete one result and put the athlete back where they belong.
 *
 * `deleteRun` above drops the row and nothing else, which leaves the
 * participant sitting in `finished` with no time — invisible on the ladder and
 * missing from the queue. This is the version the admin UI uses: it removes the
 * run and, when it was their last one, returns them to `waiting` so they can be
 * timed again.
 */
export const deleteRunResult = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ eventId: zuuid(), runId: zuuid() }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin(data.eventId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Scope the lookup to the event: an admin token is only good for one.
    const { data: run, error: runError } = await supabaseAdmin
      .from("runs")
      .select("id, participant_id")
      .eq("id", data.runId)
      .eq("event_id", data.eventId)
      .maybeSingle();
    if (runError) throw runError;
    if (!run) throw new Error("That run is not part of this event.");

    await supabaseAdmin.from("penalties").delete().eq("run_id", run.id);
    await supabaseAdmin.from("splits").delete().eq("run_id", run.id);
    const { error } = await supabaseAdmin.from("runs").delete().eq("id", run.id);
    if (error) throw error;

    const { count } = await supabaseAdmin
      .from("runs")
      .select("*", { count: "exact", head: true })
      .eq("event_id", data.eventId)
      .eq("participant_id", run.participant_id);
    if (!count) {
      const { error: statusError } = await supabaseAdmin
        .from("event_participants")
        .update(withOnClock({ participation_status: "waiting" }, null))
        .eq("event_id", data.eventId)
        .eq("participant_id", run.participant_id)
        .neq("participation_status", "scratched");
      if (statusError) throw statusError;
    }

    await supabaseAdmin.from("audit_logs").insert({
      event_id: data.eventId,
      entity_type: "runs",
      entity_id: run.id,
      action: "delete_run_result",
      performed_by: "admin",
    });

    return { ok: true, remainingRuns: count ?? 0 };
  });

/**
 * Type a result in for somebody the clock never caught.
 *
 * Phones die, saves are missed, and one year an athlete ran while the timer was
 * on the wrong screen. The entered course time is anchored to "just now" —
 * `started_at` is back-dated by that time — so the run sorts sensibly against
 * the timed ones without pretending to know when it actually happened.
 */
export const createManualRun = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        eventId: zuuid(),
        participantId: zuuid(),
        raw_time_ms: z
          .number()
          .int()
          .min(0)
          .max(24 * 60 * 60 * 1000),
        splits: z
          .array(z.object({ stationId: zuuid(), cumulative_time_ms: z.number().int().min(0) }))
          .max(50),
        penalties: z
          .array(
            z.object({
              stationId: zuuid().nullable().optional(),
              penalty_ms: z.number().int().min(0),
              reason: z.string().max(120).nullable().optional(),
            }),
          )
          .max(50),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await requireAdmin(data.eventId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { count } = await supabaseAdmin
      .from("runs")
      .select("*", { count: "exact", head: true })
      .eq("event_id", data.eventId)
      .eq("participant_id", data.participantId);

    const penaltyTotal = data.penalties.reduce((sum, p) => sum + p.penalty_ms, 0);
    const finishedAt = new Date();
    const startedAt = new Date(finishedAt.getTime() - data.raw_time_ms);

    const { data: run, error } = await supabaseAdmin
      .from("runs")
      .insert({
        event_id: data.eventId,
        participant_id: data.participantId,
        attempt_number: (count ?? 0) + 1,
        started_at: startedAt.toISOString(),
        finished_at: finishedAt.toISOString(),
        raw_time_ms: data.raw_time_ms,
        paused_duration_ms: 0,
        penalty_ms: penaltyTotal,
        status: "official",
        is_official: true,
        client_key: `manual:${crypto.randomUUID()}`,
      })
      .select()
      .single();
    if (error) throw error;

    const ordered = [...data.splits].sort((a, b) => a.cumulative_time_ms - b.cumulative_time_ms);
    if (ordered.length) {
      const { error: splitsError } = await supabaseAdmin.from("splits").insert(
        ordered.map((s, i) => ({
          run_id: run.id,
          station_id: s.stationId,
          cumulative_time_ms: s.cumulative_time_ms,
          segment_time_ms: s.cumulative_time_ms - (ordered[i - 1]?.cumulative_time_ms ?? 0),
          recorded_at: new Date(startedAt.getTime() + s.cumulative_time_ms).toISOString(),
          entry_method: "admin_manual",
          client_key: `manual:${run.id}:${s.stationId}`,
        })),
      );
      if (splitsError) throw splitsError;
    }
    if (data.penalties.length) {
      const { error: penaltiesError } = await supabaseAdmin.from("penalties").insert(
        data.penalties.map((p, i) => ({
          run_id: run.id,
          station_id: p.stationId ?? null,
          penalty_ms: p.penalty_ms,
          reason: p.reason ?? null,
          created_by: "admin",
          client_key: `manual:${run.id}:${i}`,
        })),
      );
      if (penaltiesError) throw penaltiesError;
    }

    const { error: statusError } = await supabaseAdmin
      .from("event_participants")
      .update(withOnClock({ participation_status: "finished" }, null))
      .eq("event_id", data.eventId)
      .eq("participant_id", data.participantId);
    if (statusError) throw statusError;

    await supabaseAdmin.from("audit_logs").insert({
      event_id: data.eventId,
      entity_type: "runs",
      entity_id: run.id,
      action: "manual_run_entry",
      new_value: { raw_time_ms: data.raw_time_ms, penalty_ms: penaltyTotal },
      performed_by: "admin",
    });

    return { runId: run.id };
  });

/**
 * Correct a result that is already in the books.
 *
 * A stopwatch tapped late, a split missed at the sled, a penalty argued down
 * an hour after the fact — before this the only remedy was deleting the run and
 * re-timing the athlete. The splits and penalties are replaced wholesale rather
 * than diffed: the sheet always sends the complete intended set, so a station
 * left blank means "there is no split here" and disappears.
 *
 * `official_time_ms` is a generated column (raw + penalty), so it is never
 * written here — fixing the parts fixes the total.
 */
export const updateRunResult = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        eventId: zuuid(),
        runId: zuuid(),
        raw_time_ms: z
          .number()
          .int()
          .min(0)
          .max(24 * 60 * 60 * 1000),
        splits: z
          .array(
            z.object({
              stationId: zuuid(),
              cumulative_time_ms: z.number().int().min(0),
            }),
          )
          .max(50),
        penalties: z
          .array(
            z.object({
              stationId: zuuid().nullable().optional(),
              penalty_ms: z.number().int().min(0),
              reason: z.string().max(120).nullable().optional(),
            }),
          )
          .max(50),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await requireAdmin(data.eventId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Never trust the run id alone: an admin token is scoped to one event, so
    // the run has to belong to that event before anything is touched.
    const { data: run, error: runError } = await supabaseAdmin
      .from("runs")
      .select("id, event_id, started_at, raw_time_ms, penalty_ms")
      .eq("id", data.runId)
      .eq("event_id", data.eventId)
      .maybeSingle();
    if (runError) throw runError;
    if (!run) throw new Error("That run is not part of this event.");

    const penaltyTotal = data.penalties.reduce((sum, p) => sum + p.penalty_ms, 0);

    const { error: updateError } = await supabaseAdmin
      .from("runs")
      .update({ raw_time_ms: data.raw_time_ms, penalty_ms: penaltyTotal })
      .eq("id", run.id);
    if (updateError) throw updateError;

    const { error: delSplits } = await supabaseAdmin.from("splits").delete().eq("run_id", run.id);
    if (delSplits) throw delSplits;
    const { error: delPenalties } = await supabaseAdmin
      .from("penalties")
      .delete()
      .eq("run_id", run.id);
    if (delPenalties) throw delPenalties;

    // Segment times are derived, not typed: sorting by cumulative time and
    // differencing keeps them consistent with whatever the commissioner entered.
    const ordered = [...data.splits].sort((a, b) => a.cumulative_time_ms - b.cumulative_time_ms);
    const startMs = run.started_at ? Date.parse(run.started_at) : Date.now();
    if (ordered.length) {
      const { error } = await supabaseAdmin.from("splits").insert(
        ordered.map((s, i) => ({
          run_id: run.id,
          station_id: s.stationId,
          cumulative_time_ms: s.cumulative_time_ms,
          segment_time_ms: s.cumulative_time_ms - (ordered[i - 1]?.cumulative_time_ms ?? 0),
          recorded_at: new Date(startMs + s.cumulative_time_ms).toISOString(),
          entry_method: "admin_edit",
          client_key: `edit:${run.id}:${s.stationId}`,
          corrected: true,
        })),
      );
      if (error) throw error;
    }
    if (data.penalties.length) {
      const { error } = await supabaseAdmin.from("penalties").insert(
        data.penalties.map((p, i) => ({
          run_id: run.id,
          station_id: p.stationId ?? null,
          penalty_ms: p.penalty_ms,
          reason: p.reason ?? null,
          created_by: "admin",
          client_key: `edit:${run.id}:${i}`,
        })),
      );
      if (error) throw error;
    }

    await supabaseAdmin.from("audit_logs").insert({
      event_id: data.eventId,
      entity_type: "runs",
      entity_id: run.id,
      action: "update_run_result",
      previous_value: { raw_time_ms: run.raw_time_ms, penalty_ms: run.penalty_ms },
      new_value: { raw_time_ms: data.raw_time_ms, penalty_ms: penaltyTotal },
      performed_by: "admin",
    });

    return { ok: true, official_time_ms: data.raw_time_ms + penaltyTotal };
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
