import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@/integrations/supabase/client");
  vi.restoreAllMocks();
});

describe("global Supabase auth middleware", () => {
  async function invokeMiddleware() {
    const { startInstance } = await import("./start");
    const { functionMiddleware } = await startInstance.getOptions();
    const client = functionMiddleware?.[0]?.options.client;
    if (!client) throw new Error("Global auth middleware is missing its client handler");
    const next = vi.fn().mockResolvedValue({});
    await client({ next } as unknown as Parameters<typeof client>[0]);
    return next;
  }

  it("continues without an auth header when storage blocks client construction", async () => {
    vi.doMock("@/integrations/supabase/client", () => ({
      supabase: new Proxy(
        {},
        {
          get() {
            throw new DOMException("Storage blocked", "SecurityError");
          },
        },
      ),
    }));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const next = await invokeMiddleware();
    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith({ headers: {} });
  });

  it.each([
    ["a session exists", { access_token: "test-token" }, { Authorization: "Bearer test-token" }],
    ["there is no session", null, {}],
  ])("forwards the expected headers when %s", async (_case, session, headers) => {
    vi.doMock("@/integrations/supabase/client", () => ({
      supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session } }) } },
    }));

    const next = await invokeMiddleware();
    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith({ headers });
  });
});
