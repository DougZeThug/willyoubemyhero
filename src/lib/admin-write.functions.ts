import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "./require-auth.server";

// ---------- Participants (global) ----------
export const upsertParticipant = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        eventId: z.string().uuid(),
        id: z.string().uuid().optional(),
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
        eventId: z.string().uuid(),
        participantId: z.string().uuid(),
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
    z.object({ eventId: z.string().uuid(), eventParticipantId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    await requireAdmin(data.eventId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("event_participants")
      .delete()
      .eq("id", data.eventParticipantId);
    if (error) throw error;
    return { ok: true };
  });

export const setParticipantStatus = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        eventId: z.string().uuid(),
        eventParticipantId: z.string().uuid(),
        status: z.string(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await requireAdmin(data.eventId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("event_participants")
      .update({ participation_status: data.status })
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
  .inputValidator((d: unknown) => z.object({ eventId: z.string().uuid() }).parse(d))
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
      .update({ participation_status: "waiting" })
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
        eventId: z.string().uuid(),
        order: z.array(z.object({ id: z.string().uuid(), running_order: z.number().int() })),
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
        eventId: z.string().uuid(),
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
        eventId: z.string().uuid(),
        id: z.string().uuid().optional(),
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
  .inputValidator((d: unknown) =>
    z.object({ eventId: z.string().uuid(), id: z.string().uuid() }).parse(d),
  )
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
        eventId: z.string().uuid(),
        participantId: z.string().uuid(),
        clientKey: z.string().min(8),
        started_at: z.string(),
        finished_at: z.string(),
        raw_time_ms: z.number().int().nonnegative(),
        paused_duration_ms: z.number().int().nonnegative().default(0),
        splits: z
          .array(
            z.object({
              stationId: z.string().uuid(),
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
              stationId: z.string().uuid().nullable(),
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

    // Attempt count
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
          attempt_number: (count ?? 0) + 1,
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
      await supabaseAdmin.from("splits").upsert(
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
    }
    if (data.penalties.length) {
      await supabaseAdmin.from("penalties").upsert(
        data.penalties.map((p) => ({
          run_id: run.id,
          station_id: p.stationId,
          penalty_ms: p.penalty_ms,
          reason: p.reason,
          client_key: p.clientKey,
        })),
        { onConflict: "client_key" },
      );
    }

    // Mark participant finished
    await supabaseAdmin
      .from("event_participants")
      .update({ participation_status: "finished" })
      .eq("event_id", data.eventId)
      .eq("participant_id", data.participantId);

    return { runId: run.id };
  });

export const deleteRun = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ eventId: z.string().uuid(), runId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    await requireAdmin(data.eventId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("runs").delete().eq("id", data.runId);
    if (error) throw error;
    return { ok: true };
  });

// ---------- Draft selections ----------
export const recordDraftSelection = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        eventId: z.string().uuid(),
        participantId: z.string().uuid(),
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
  .inputValidator((d: unknown) => z.object({ eventId: z.string().uuid() }).parse(d))
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
        eventId: z.string().uuid(),
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
