import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock } from "@/test/supabase-mock";
import { adminHeaders, callServerFn } from "@/test/server-fn";
import { signAdminToken } from "./session.server";

let mock = createSupabaseMock();
vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return mock.client;
  },
}));

const EVENT_ID = "00000000-0000-4000-8000-0000000000ff";
const EVENT_PARTICIPANT_ID = "00000000-0000-4000-8000-000000000011";
const PARENT_ID = "00000000-0000-4000-8000-000000000022";
beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-session-secret");
  mock = createSupabaseMock();
});

describe("card prompt persistence authorization", () => {
  it("rejects unauthenticated template reads and writes", async () => {
    const { listCardPromptTemplates, updateCardPromptTemplate } =
      await import("./card-prompt.functions");
    await expect(callServerFn(listCardPromptTemplates)).rejects.toThrow("Admin PIN required");
    await expect(
      callServerFn(updateCardPromptTemplate, {
        data: {
          slug: "secret_pet",
          masterPrompt: "A sufficiently long replacement master prompt.",
        },
      }),
    ).rejects.toThrow("Admin PIN required");
    expect(mock.calls).toHaveLength(0);
  });

  it("rejects unauthenticated history reads and writes", async () => {
    const { listCardPromptRuns, saveCardPromptRun } = await import("./card-prompt.functions");
    await expect(
      callServerFn(listCardPromptRuns, { data: { eventId: EVENT_ID, limit: 30 } }),
    ).rejects.toThrow("Admin PIN required");
    await expect(
      callServerFn(saveCardPromptRun, {
        data: {
          eventId: EVENT_ID,
          templateSlug: "secret_pet",
          templateName: "Secret Pet",
          subjectName: "Pickles",
          inputSnapshot: {},
          generatedPrompt: "A sufficiently long generated prompt for Pickles.",
          kind: "initial",
        },
      }),
    ).rejects.toThrow("Admin PIN required");
  });

  it("validates template prompt length before touching the database", async () => {
    const { updateCardPromptTemplate } = await import("./card-prompt.functions");
    await expect(
      callServerFn(updateCardPromptTemplate, {
        data: { slug: "secret_pet", masterPrompt: "short" },
      }),
    ).rejects.toThrow();
    expect(mock.calls).toHaveLength(0);
  });

  it("requires every revision to name its original prompt", async () => {
    const { saveCardPromptRun } = await import("./card-prompt.functions");
    await expect(
      callServerFn(saveCardPromptRun, {
        data: {
          eventId: EVENT_ID,
          templateSlug: "secret_pet",
          templateName: "Secret Pet",
          subjectName: "Pickles",
          inputSnapshot: {},
          generatedPrompt: "A sufficiently long revision prompt for Pickles.",
          kind: "revision",
          revisionInstruction: "Make the collar blue",
        },
      }),
    ).rejects.toThrow("Revisions require an original prompt");
    expect(mock.calls).toHaveLength(0);
  });

  it("rejects an event participant that is not in the authorized event", async () => {
    mock = createSupabaseMock({ "event_participants.select": { data: null } });
    const { saveCardPromptRun } = await import("./card-prompt.functions");
    await expect(
      callServerFn(saveCardPromptRun, {
        headers: adminHeaders(signAdminToken(EVENT_ID).token),
        data: {
          eventId: EVENT_ID,
          eventParticipantId: EVENT_PARTICIPANT_ID,
          templateSlug: "secret_pet",
          templateName: "Secret Pet",
          subjectName: "Pickles",
          inputSnapshot: {},
          generatedPrompt: "A sufficiently long initial prompt for Pickles.",
          kind: "initial",
        },
      }),
    ).rejects.toThrow("Participant does not belong to this event");
    expect(mock.callsFor("card_prompt_runs", "insert")).toHaveLength(0);
  });

  it("rejects a revision parent that is not an initial run in the authorized event", async () => {
    mock = createSupabaseMock({ "card_prompt_runs.select": { data: null } });
    const { saveCardPromptRun } = await import("./card-prompt.functions");
    await expect(
      callServerFn(saveCardPromptRun, {
        headers: adminHeaders(signAdminToken(EVENT_ID).token),
        data: {
          eventId: EVENT_ID,
          templateSlug: "secret_pet",
          templateName: "Secret Pet",
          subjectName: "Pickles",
          inputSnapshot: {},
          generatedPrompt: "A sufficiently long revision prompt for Pickles.",
          kind: "revision",
          parentPromptId: PARENT_ID,
          revisionInstruction: "Make the collar blue",
        },
      }),
    ).rejects.toThrow("Original prompt does not belong to this event");
    expect(mock.callsFor("card_prompt_runs", "insert")).toHaveLength(0);
  });

  it("inserts a valid initial run with server-derived template metadata", async () => {
    mock = createSupabaseMock({
      "card_prompt_runs.insert": { data: { id: PARENT_ID } },
    });
    const { saveCardPromptRun } = await import("./card-prompt.functions");
    await callServerFn(saveCardPromptRun, {
      headers: adminHeaders(signAdminToken(EVENT_ID).token),
      data: {
        eventId: EVENT_ID,
        templateId: null,
        templateSlug: "secret_pet",
        templateName: "Untrusted client name",
        subjectName: "Pickles",
        inputSnapshot: { colors: "blue" },
        generatedPrompt: "A sufficiently long initial prompt for Pickles.",
        kind: "initial",
      },
    });
    const [insert] = mock.callsFor("card_prompt_runs", "insert");
    expect(insert.payload).toMatchObject({
      template_id: null,
      template_slug: "secret_pet",
      template_name_snapshot: "Secret Pet",
      event_id: EVENT_ID,
      event_participant_id: null,
      subject_name: "Pickles",
      input_snapshot: { colors: "blue" },
      kind: "initial",
      parent_prompt_id: null,
    });
  });

  it("lists and updates templates for the active-event administrator", async () => {
    mock = createSupabaseMock({
      "events.select": { data: { id: EVENT_ID } },
      "card_prompt_templates.select": { data: [{ slug: "secret_pet" }] },
      "card_prompt_templates.update": {
        data: { slug: "secret_pet", master_prompt: "A replacement prompt with sufficient detail." },
      },
    });
    const { listCardPromptTemplates, updateCardPromptTemplate } =
      await import("./card-prompt.functions");
    const headers = adminHeaders(signAdminToken(EVENT_ID).token);
    await expect(callServerFn(listCardPromptTemplates, { headers })).resolves.toEqual({
      templates: [{ slug: "secret_pet" }],
    });
    await expect(
      callServerFn(updateCardPromptTemplate, {
        headers,
        data: {
          slug: "secret_pet",
          masterPrompt: "A replacement prompt with sufficient detail.",
        },
      }),
    ).resolves.toMatchObject({ slug: "secret_pet" });
  });
});
