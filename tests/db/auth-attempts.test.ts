// The credential-attempt limiter, against real Postgres.
//
// Two properties live here: the counter is atomic (one call both counts and
// answers, so parallel guesses cannot share an allowance), and nothing that
// ships to a browser can reach it in any direction.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { asRole, closeDb, isDenied, sql } from "./helpers";

afterAll(closeDb);
beforeEach(async () => {
  await sql("DELETE FROM public.auth_attempts");
});

async function note(kind: string, key: string, windowS = 600, max = 3) {
  const [row] = await sql<{ note_auth_attempt: boolean }>(
    "SELECT public.note_auth_attempt($1, $2, $3, $4)",
    [kind, key, windowS, max],
  );
  return row.note_auth_attempt;
}

describe("note_auth_attempt", () => {
  it("is callable as service_role — the only caller the app has", async () => {
    // REVOKE FROM PUBLIC also strips the default EXECUTE service_role
    // inherits, and the handlers fail open on a limiter error — so a missing
    // grant would leave the limiter silently inert. This test runs the way the
    // app actually connects, not as the migration's owner.
    const [row] = await asRole<{ note_auth_attempt: boolean }>(
      "service_role",
      "SELECT public.note_auth_attempt($1, $2, $3, $4)",
      ["pin", "svc", 600, 10],
    );
    expect(row.note_auth_attempt).toBe(true);
    await asRole("service_role", "SELECT public.clear_auth_attempts($1, $2)", ["pin", "svc"]);
  });

  it("is unreachable with the publishable key, table and functions alike", async () => {
    // Without the REVOKEs, anyone holding the key that ships to every browser
    // could read who is being counted — or wipe their own counter.
    for (const role of ["anon", "authenticated"] as const) {
      expect(await isDenied(role, "SELECT * FROM public.auth_attempts")).toBe(true);
      expect(
        await isDenied(role, "SELECT public.note_auth_attempt($1, $2, $3, $4)", [
          "pin",
          "x",
          600,
          10,
        ]),
      ).toBe(true);
      expect(await isDenied(role, "SELECT public.clear_auth_attempts($1, $2)", ["pin", "x"])).toBe(
        true,
      );
    }
  });

  it("allows up to the max and refuses from the next attempt on", async () => {
    expect(await note("pin", "event-1")).toBe(true);
    expect(await note("pin", "event-1")).toBe(true);
    expect(await note("pin", "event-1")).toBe(true);
    expect(await note("pin", "event-1")).toBe(false);
    expect(await note("pin", "event-1")).toBe(false);
  });

  it("counts kinds and keys separately", async () => {
    for (let i = 0; i < 3; i++) await note("pin", "event-1");
    expect(await note("pin", "event-1")).toBe(false);
    // A different event, and a claim against the same string, both start fresh.
    expect(await note("pin", "event-2")).toBe(true);
    expect(await note("claim", "event-1")).toBe(true);
  });

  it("restarts a stale window instead of punishing forever", async () => {
    for (let i = 0; i < 4; i++) await note("pin", "event-1");
    expect(await note("pin", "event-1")).toBe(false);
    // Age the window past its length the way real time would.
    await sql(
      "UPDATE public.auth_attempts SET window_started_at = now() - interval '11 minutes' WHERE kind = 'pin' AND key = 'event-1'",
    );
    expect(await note("pin", "event-1")).toBe(true);
    // And the restart really did reset the count, not just answer true once.
    expect(await note("pin", "event-1")).toBe(true);
  });

  it("clear_auth_attempts hands the slate back", async () => {
    for (let i = 0; i < 4; i++) await note("pin", "event-1");
    expect(await note("pin", "event-1")).toBe(false);
    await sql("SELECT public.clear_auth_attempts($1, $2)", ["pin", "event-1"]);
    expect(await note("pin", "event-1")).toBe(true);
  });
});
