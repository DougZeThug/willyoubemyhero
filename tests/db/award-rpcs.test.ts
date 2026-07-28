// The three award RPCs.
//
// Voting is the one place in this app with a real concurrency requirement: a
// ballot cast while the commissioner is closing voting must either be counted
// or refused, never silently dropped. That is why the logic lives in Postgres
// behind a row lock rather than in the server function.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, IDS, seedEvent, sql } from "./helpers";
import { AWARD_CATEGORIES } from "../../src/lib/awards";

const CATEGORIES = AWARD_CATEGORIES.map((c) => ({ id: c.id, label: c.label }));

afterAll(closeDb);
beforeEach(seedEvent);

function castVote(voter: string, target: string, category = "mvp") {
  return sql("SELECT public.cast_award_vote($1, $2, $3, $4)", [IDS.event, category, voter, target]);
}

function closeVoting() {
  return sql<{ close_award_voting: number }>("SELECT public.close_award_voting($1, $2::jsonb)", [
    IDS.event,
    JSON.stringify(CATEGORIES),
  ]);
}

function votes() {
  return sql<{ category: string; voter_participant_id: string; target_participant_id: string }>(
    "SELECT category, voter_participant_id, target_participant_id FROM public.award_votes ORDER BY category",
  );
}

function awards() {
  return sql<{ award_type: string; participant_id: string; award_name: string }>(
    "SELECT award_type, participant_id, award_name FROM public.awards ORDER BY award_type, participant_id",
  );
}

async function isLocked() {
  const [row] = await sql<{ awards_locked: boolean }>(
    "SELECT awards_locked FROM public.events WHERE id = $1",
    [IDS.event],
  );
  return row.awards_locked;
}

describe("cast_award_vote", () => {
  it("records a vote", async () => {
    await castVote(IDS.alice, IDS.bob);
    expect(await votes()).toEqual([
      { category: "mvp", voter_participant_id: IDS.alice, target_participant_id: IDS.bob },
    ]);
  });

  it("replaces your vote when you change your mind, rather than adding one", async () => {
    await castVote(IDS.alice, IDS.bob);
    await castVote(IDS.alice, IDS.carol);
    const rows = await votes();
    expect(rows).toHaveLength(1);
    expect(rows[0].target_participant_id).toBe(IDS.carol);
  });

  it("keeps one vote per member per category, and lets you vote in each", async () => {
    await castVote(IDS.alice, IDS.bob, "mvp");
    await castVote(IDS.alice, IDS.carol, "clutch");
    expect(await votes()).toHaveLength(2);
  });

  it("keeps different voters separate", async () => {
    await castVote(IDS.alice, IDS.carol);
    await castVote(IDS.bob, IDS.carol);
    expect(await votes()).toHaveLength(2);
  });

  it("refuses a nominee who is not on the event roster", async () => {
    await expect(castVote(IDS.alice, IDS.outsider)).rejects.toThrow();
    expect(await votes()).toEqual([]);
  });

  it("checks the nominee's roster membership but not the voter's", async () => {
    // Asymmetric on purpose, as far as the RPC's own contract goes: it exists to
    // stop a vote naming somebody who is not in the combine. The voter id never
    // comes from the client — castAwardVote passes the id off the member token —
    // so the only person this would let through is a claimed league member who
    // is not rostered for this particular event. Recorded here so that if the
    // rule ever needs tightening, the change is visible rather than silent.
    await expect(castVote(IDS.outsider, IDS.alice)).resolves.toBeTruthy();
    expect(await votes()).toHaveLength(1);
  });

  it("refuses once voting is closed", async () => {
    await sql("UPDATE public.events SET awards_locked = true WHERE id = $1", [IDS.event]);
    await expect(castVote(IDS.alice, IDS.bob)).rejects.toThrow();
    expect(await votes()).toEqual([]);
  });

  it("lets you vote for yourself — this is a friend group, not an election", async () => {
    await expect(castVote(IDS.alice, IDS.alice)).resolves.toBeTruthy();
  });
});

describe("close_award_voting", () => {
  it("publishes the winner of each contested category", async () => {
    await castVote(IDS.alice, IDS.carol, "mvp");
    await castVote(IDS.bob, IDS.carol, "mvp");
    await castVote(IDS.carol, IDS.alice, "mvp");

    const [{ close_award_voting: published }] = await closeVoting();
    expect(published).toBeGreaterThan(0);

    const rows = await awards();
    expect(rows).toEqual([{ award_type: "mvp", participant_id: IDS.carol, award_name: "MVP" }]);
  });

  it("publishes joint winners on a tie rather than picking by row order", async () => {
    // With 13 voters a tie is common, and breaking it arbitrarily would be a
    // lie about what the room actually voted.
    await castVote(IDS.alice, IDS.bob, "mvp");
    await castVote(IDS.carol, IDS.alice, "mvp");

    await closeVoting();
    const winners = (await awards()).filter((a) => a.award_type === "mvp");
    expect(winners.map((w) => w.participant_id).sort()).toEqual([IDS.alice, IDS.bob].sort());
  });

  it("publishes nothing for a category nobody voted in", async () => {
    await castVote(IDS.alice, IDS.bob, "mvp");
    await closeVoting();
    const types = (await awards()).map((a) => a.award_type);
    expect(types).toEqual(["mvp"]);
  });

  it("publishes nothing at all when no votes were cast", async () => {
    const [{ close_award_voting: published }] = await closeVoting();
    expect(published).toBe(0);
    expect(await awards()).toEqual([]);
  });

  it("locks voting, so a late ballot is refused rather than dropped", async () => {
    await castVote(IDS.alice, IDS.bob, "mvp");
    await closeVoting();
    expect(await isLocked()).toBe(true);
    await expect(castVote(IDS.carol, IDS.bob, "mvp")).rejects.toThrow();
  });

  it("uses the label the app passes in as the published award name", async () => {
    await castVote(IDS.alice, IDS.bob, "clutch");
    await closeVoting();
    const [row] = (await awards()).filter((a) => a.award_type === "clutch");
    expect(row.award_name).toBe(AWARD_CATEGORIES.find((c) => c.id === "clutch")!.label);
  });

  it("is idempotent enough not to double-publish if run twice", async () => {
    await castVote(IDS.alice, IDS.bob, "mvp");
    await closeVoting();
    const first = await awards();
    // Second call finds voting already locked; whether it refuses or no-ops,
    // it must not leave two rows for one award.
    await closeVoting().catch(() => undefined);
    expect(await awards()).toEqual(first);
  });
});

describe("reopen_award_voting", () => {
  it("unlocks voting and clears the published winners", async () => {
    await castVote(IDS.alice, IDS.bob, "mvp");
    await closeVoting();
    expect(await awards()).toHaveLength(1);

    await sql("SELECT public.reopen_award_voting($1)", [IDS.event]);
    expect(await isLocked()).toBe(false);
    expect(await awards()).toEqual([]);
  });

  it("keeps the ballots, so reopening does not lose what was already cast", async () => {
    await castVote(IDS.alice, IDS.bob, "mvp");
    await closeVoting();
    await sql("SELECT public.reopen_award_voting($1)", [IDS.event]);
    expect(await votes()).toHaveLength(1);
  });

  it("lets voting resume, and a re-close republishes", async () => {
    await castVote(IDS.alice, IDS.bob, "mvp");
    await closeVoting();
    await sql("SELECT public.reopen_award_voting($1)", [IDS.event]);

    await castVote(IDS.carol, IDS.bob, "mvp");
    await closeVoting();
    const winners = (await awards()).filter((a) => a.award_type === "mvp");
    expect(winners.map((w) => w.participant_id)).toEqual([IDS.bob]);
  });
});
