// The public read every screen depends on. Each table is fetched behind a
// `safe()` wrapper so one broken read cannot blank the whole page — which is
// right, but it used to coalesce a failure to `[]` with nothing to distinguish
// it from a genuinely empty combine.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock, type SupabaseResponses } from "@/test/supabase-mock";
import { EVENT_ID } from "@/test/fixtures";

let mock = createSupabaseMock();

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => mock.client,
}));

function withDb(responses: SupabaseResponses = {}) {
  mock = createSupabaseMock(responses);
}

async function bundle() {
  const { getEventBundle } = await import("./event.functions");
  return getEventBundle({ data: { eventId: EVENT_ID } });
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  withDb();
});

describe("getEventBundle", () => {
  it("reports no failures when every table answers", async () => {
    const result = await bundle();
    expect(result.failed).toEqual([]);
  });

  it("names the table that errored", async () => {
    withDb({ "event_participants.select": { error: { message: "permission denied" } } });
    const result = await bundle();
    expect(result.failed).toEqual(["event_participants"]);
  });

  it("names a table whose read rejected outright", async () => {
    withDb({
      "runs.select": () => {
        throw new Error("socket hang up");
      },
    });
    const result = await bundle();
    expect(result.failed).toEqual(["runs"]);
  });

  it("still returns the tables that did answer", async () => {
    // The whole point of the safe() wrapper: a broken splits read must not take
    // the roster off the screen with it.
    const participants = [{ id: "ep-1" }];
    withDb({
      "event_participants.select": { data: participants },
      "splits.select": { error: { message: "boom" } },
    });
    const result = await bundle();
    expect(result.participants).toEqual(participants);
    expect(result.splits).toEqual([]);
    expect(result.failed).toEqual(["splits"]);
  });

  it("collects every failure, not just the first", async () => {
    withDb({
      "stations.select": { error: { message: "boom" } },
      "penalties.select": { error: { message: "boom" } },
    });
    const result = await bundle();
    expect(result.failed.sort()).toEqual(["penalties", "stations"]);
  });

  it("does not call a missing event a failure", async () => {
    // maybeSingle on an id nobody has is an empty answer, not a broken read.
    withDb({ "events_public.select": { data: null } });
    const result = await bundle();
    expect(result.event).toBeNull();
    expect(result.failed).toEqual([]);
  });
});
