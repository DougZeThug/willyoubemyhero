// Taking and giving back a draft pick.
//
// Both halves used to be client-driven writes with nothing tying them together:
// the selection row went in, then the roster was stamped, and a failure between
// the two left a square reading "Open" that UNIQUE(event_id, draft_position)
// then refused forever. selection_order was count + 1 with no constraint behind
// it, so two picks landing together shared a number and undo took whichever.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, IDS, newClient, seedEvent, sql } from "./helpers";

afterAll(closeDb);
beforeEach(seedEvent);

function pick(participant: string, position: number) {
  return sql<{ record_draft_selection: number }>(
    "SELECT public.record_draft_selection($1, $2, $3)",
    [IDS.event, participant, position],
  );
}

function undo() {
  return sql<{ undo_last_draft_selection: string | null }>(
    "SELECT public.undo_last_draft_selection($1)",
    [IDS.event],
  );
}

function board() {
  return sql<{ participant_id: string; selection_order: number; draft_position: number }>(
    `SELECT participant_id, selection_order, draft_position
     FROM public.draft_selections WHERE event_id = $1 ORDER BY selection_order`,
    [IDS.event],
  );
}

function stampFor(participant: string) {
  return sql<{ selected_draft_position: number | null }>(
    `SELECT selected_draft_position FROM public.event_participants
     WHERE event_id = $1 AND participant_id = $2`,
    [IDS.event, participant],
  );
}

describe("record_draft_selection", () => {
  it("numbers picks consecutively and stamps the roster in the same breath", async () => {
    const [first] = await pick(IDS.alice, 3);
    const [second] = await pick(IDS.bob, 1);
    expect([first.record_draft_selection, second.record_draft_selection]).toEqual([1, 2]);
    expect(await board()).toEqual([
      { participant_id: IDS.alice, selection_order: 1, draft_position: 3 },
      { participant_id: IDS.bob, selection_order: 2, draft_position: 1 },
    ]);
    expect(await stampFor(IDS.alice)).toEqual([{ selected_draft_position: 3 }]);
  });

  it("takes nothing when the athlete is not on the roster", async () => {
    // The failure mode the RPC exists for: the selection row must not survive a
    // roster stamp that matched nobody.
    await expect(pick(IDS.outsider, 2)).rejects.toThrow(/not on this roster/);
    expect(await board()).toEqual([]);
  });

  it("refuses a second pick for the same square", async () => {
    await pick(IDS.alice, 1);
    await expect(pick(IDS.bob, 1)).rejects.toThrow();
  });

  it("serialises two picks landing at once onto different numbers", async () => {
    // The count + 1 this replaced let both reads see the same board.
    const a = await newClient();
    const b = await newClient();
    try {
      await a.query("BEGIN");
      await a.query("SELECT public.record_draft_selection($1, $2, $3)", [IDS.event, IDS.alice, 1]);
      // b blocks on the event row lock until a commits.
      const pending = b.query("SELECT public.record_draft_selection($1, $2, $3)", [
        IDS.event,
        IDS.bob,
        2,
      ]);
      await a.query("COMMIT");
      await pending;
      expect((await board()).map((r) => r.selection_order)).toEqual([1, 2]);
    } finally {
      await a.end();
      await b.end();
    }
  });
});

describe("undo_last_draft_selection", () => {
  it("gives back the last pick and clears its stamp", async () => {
    await pick(IDS.alice, 3);
    await pick(IDS.bob, 1);
    const [res] = await undo();
    expect(res.undo_last_draft_selection).toBe(IDS.bob);
    expect(await board()).toEqual([
      { participant_id: IDS.alice, selection_order: 1, draft_position: 3 },
    ]);
    expect(await stampFor(IDS.bob)).toEqual([{ selected_draft_position: null }]);
  });

  it("returns null on a board nobody has picked from", async () => {
    // The handler used to answer ok here, so the screen said "Undid last pick"
    // over a draft nobody had started.
    const [res] = await undo();
    expect(res.undo_last_draft_selection).toBeNull();
  });

  it("frees the square so it can be picked again", async () => {
    await pick(IDS.alice, 1);
    await undo();
    await expect(pick(IDS.bob, 1)).resolves.toBeDefined();
  });
});

describe("draft_selections uniqueness", () => {
  it("refuses two picks sharing a selection_order", async () => {
    await pick(IDS.alice, 1);
    await expect(
      sql(
        `INSERT INTO public.draft_selections (event_id, participant_id, selection_order, draft_position)
         VALUES ($1, $2, 1, 2)`,
        [IDS.event, IDS.bob],
      ),
    ).rejects.toThrow();
  });
});
