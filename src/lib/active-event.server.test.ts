import { describe, expect, it, vi } from "vitest";
import { createSupabaseMock } from "@/test/supabase-mock";

let mock = createSupabaseMock();
vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return mock.client;
  },
}));

const EVENT_ID = "00000000-0000-4000-8000-0000000000ff";

describe("activeEventId", () => {
  it("is the newest active event", async () => {
    mock = createSupabaseMock({ "events.select": { data: { id: EVENT_ID } } });
    const { activeEventId } = await import("./active-event.server");
    expect(await activeEventId()).toBe(EVENT_ID);
    const call = mock.callsFor("events", "select")[0];
    expect(mock.eqValue(call, "active")).toBe(true);
  });

  it("is null out of season, when no event is active", async () => {
    mock = createSupabaseMock({ "events.select": { data: null } });
    const { activeEventId } = await import("./active-event.server");
    expect(await activeEventId()).toBeNull();
  });

  it("throws on a failed lookup, so an outage never reads as out of season", async () => {
    mock = createSupabaseMock({ "events.select": { error: { message: "connection reset" } } });
    const { activeEventId } = await import("./active-event.server");
    await expect(activeEventId()).rejects.toThrow("connection reset");
  });
});
