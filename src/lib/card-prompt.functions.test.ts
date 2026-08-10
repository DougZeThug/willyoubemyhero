import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock } from "@/test/supabase-mock";
import { callServerFn } from "@/test/server-fn";

let mock = createSupabaseMock();
vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return mock.client;
  },
}));

const EVENT_ID = "00000000-0000-4000-8000-0000000000ff";
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
});
