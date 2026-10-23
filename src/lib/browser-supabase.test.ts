import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@/integrations/supabase/client");
});

describe("browserSupabase", () => {
  it("returns null instead of throwing when the client cannot be built (storage blocked)", async () => {
    vi.doMock("@/integrations/supabase/client", () => ({
      supabase: new Proxy(
        {},
        {
          get() {
            throw new DOMException("The operation is insecure.", "SecurityError");
          },
        },
      ),
    }));
    const { browserSupabase } = await import("./browser-supabase");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(browserSupabase()).toBeNull();
  });

  it("returns the client when it builds", async () => {
    const client = { auth: {} };
    vi.doMock("@/integrations/supabase/client", () => ({ supabase: client }));
    const { browserSupabase } = await import("./browser-supabase");
    expect(browserSupabase()).toBe(client);
  });
});
