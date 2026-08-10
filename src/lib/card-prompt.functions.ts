import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader, setResponseHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireAdmin } from "./require-auth.server";

async function db() {
  const { cardPromptDb } = await import("./card-prompt-db.server");
  return cardPromptDb();
}

async function requireLeagueAdmin(): Promise<string> {
  if (!getRequestHeader("x-admin-token")) throw new Error("Admin PIN required");
  const sb = await db();
  const { data: event } = await sb
    .from("events")
    .select("id")
    .eq("active", true)
    .order("year", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!event) throw new Error("Admin PIN required");
  await requireAdmin(event.id);
  return event.id;
}

function noStore() {
  setResponseHeader("Cache-Control", "private, no-store");
}
const slug = z.enum([
  "draft_combine_player",
  "cornhole_player",
  "secret_pet",
  "legacy_pet",
  "wag_secret_rare",
  "custom_secret",
]);

export const listCardPromptTemplates = createServerFn({ method: "GET" }).handler(async () => {
  await requireLeagueAdmin();
  noStore();
  const client = await db();
  const { data, error } = await client
    .from("card_prompt_templates")
    .select("*")
    .eq("active", true)
    .order("sort_order");
  if (error) throw new Error(error.message);
  return { templates: data ?? [] };
});

export const updateCardPromptTemplate = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z.object({ slug, masterPrompt: z.string().trim().min(20).max(12000) }).parse(data),
  )
  .handler(async ({ data }) => {
    await requireLeagueAdmin();
    const client = await db();
    const { data: row, error } = await client
      .from("card_prompt_templates")
      .update({ master_prompt: data.masterPrompt })
      .eq("slug", data.slug)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

const snapshot = z.record(z.string(), z.unknown()).default({});
const saveSchema = z
  .object({
    eventId: z.string().uuid(),
    templateId: z.string().uuid().nullable().optional(),
    templateSlug: slug,
    templateName: z.string().min(1).max(120),
    eventParticipantId: z.string().uuid().nullable().optional(),
    subjectName: z.string().trim().min(1).max(120),
    inputSnapshot: snapshot,
    generatedPrompt: z.string().min(20).max(20000),
    kind: z.enum(["initial", "revision"]),
    parentPromptId: z.string().uuid().nullable().optional(),
    revisionInstruction: z.string().max(4000).nullable().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.kind === "revision" && !data.parentPromptId) {
      ctx.addIssue({
        code: "custom",
        path: ["parentPromptId"],
        message: "Revisions require an original prompt",
      });
    }
  });

export const saveCardPromptRun = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => saveSchema.parse(data))
  .handler(async ({ data }) => {
    await requireAdmin(data.eventId);
    const client = await db();
    if (data.eventParticipantId) {
      const { data: participant, error: participantError } = await client
        .from("event_participants")
        .select("id,event_id")
        .eq("id", data.eventParticipantId)
        .eq("event_id", data.eventId)
        .maybeSingle();
      if (participantError) throw new Error(participantError.message);
      if (!participant) throw new Error("Participant does not belong to this event");
    }
    if (data.kind === "revision") {
      const { data: parent, error: parentError } = await client
        .from("card_prompt_runs")
        .select("id,event_id,kind")
        .eq("id", data.parentPromptId!)
        .eq("event_id", data.eventId)
        .eq("kind", "initial")
        .maybeSingle();
      if (parentError) throw new Error(parentError.message);
      if (!parent) throw new Error("Original prompt does not belong to this event");
    }
    const { data: row, error } = await client
      .from("card_prompt_runs")
      .insert({
        template_id: data.templateId ?? null,
        template_slug: data.templateSlug,
        template_name_snapshot: data.templateName,
        event_id: data.eventId,
        event_participant_id: data.eventParticipantId ?? null,
        subject_name: data.subjectName,
        input_snapshot: data.inputSnapshot,
        generated_prompt: data.generatedPrompt,
        kind: data.kind,
        parent_prompt_id: data.parentPromptId ?? null,
        revision_instruction: data.revisionInstruction ?? null,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const listCardPromptRuns = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) =>
    z
      .object({ eventId: z.string().uuid(), limit: z.number().int().min(1).max(50).default(30) })
      .parse(data),
  )
  .handler(async ({ data }) => {
    await requireAdmin(data.eventId);
    noStore();
    const client = await db();
    const { data: rows, error } = await client
      .from("card_prompt_runs")
      .select("*")
      .eq("event_id", data.eventId)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);
    return { runs: rows ?? [] };
  });
