import { describe, it, expect } from "vitest";
import { awaitingRun, currentAthlete, fieldSize, idleFieldState } from "./current-athlete";

const ep = (running_order: number, participation_status: string) => ({
  running_order,
  participation_status,
});

describe("currentAthlete", () => {
  it("prefers whoever the admin put on the clock", () => {
    const parts = [ep(1, "waiting"), ep(4, "running")];
    expect(currentAthlete(parts)).toEqual({ athlete: parts[1], onClock: true });
  });

  it("falls back to the first unfinished athlete in running order", () => {
    const parts = [ep(3, "waiting"), ep(1, "finished"), ep(2, "waiting")];
    expect(currentAthlete(parts)).toEqual({ athlete: parts[2], onClock: false });
  });

  it("skips scratched athletes", () => {
    const parts = [ep(1, "scratched"), ep(2, "waiting")];
    expect(currentAthlete(parts).athlete).toBe(parts[1]);
  });

  it.each(["dq", "dnp", "absent"])("skips a %s athlete too", (status) => {
    // Only finished and scratched used to count as done, so anybody in the rest
    // of the out-of-contention family owned the Up Next slot indefinitely and
    // the queue never moved past them.
    const parts = [ep(1, status), ep(2, "waiting")];
    expect(currentAthlete(parts).athlete).toBe(parts[1]);
  });

  it("returns nothing once the field is done", () => {
    expect(currentAthlete([ep(1, "finished")])).toEqual({ athlete: null, onClock: false });
  });
});

describe("fieldSize", () => {
  it("excludes scratched athletes", () => {
    expect(fieldSize([ep(1, "waiting"), ep(2, "scratched"), ep(3, "finished")])).toBe(2);
  });

  it("excludes the rest of the out-of-contention family", () => {
    // They are never going to finish, so counting them in the denominator holds
    // the screen at "12 of 13" for the rest of the party.
    expect(fieldSize([ep(1, "waiting"), ep(2, "dq"), ep(3, "dnp"), ep(4, "absent")])).toBe(1);
  });
});

describe("idleFieldState", () => {
  it("does not congratulate a field that does not exist yet", () => {
    // The bug this exists for: /live printed "Every athlete is done. Nice work."
    // over a 0/0 counter before the first fetch had returned.
    expect(idleFieldState(0, 0, false)).toBe("no-roster");
  });

  it("says the read failed rather than blaming the roster", () => {
    // getEventBundle coalesces a failed table read to an empty array, so an
    // unreadable roster and an unset one arrive looking identical.
    expect(idleFieldState(0, 0, true)).toBe("roster-failed");
    expect(idleFieldState(3, 3, true)).toBe("roster-failed");
  });

  it("congratulates a field that really has finished", () => {
    expect(idleFieldState(3, 3, false)).toBe("all-done");
  });

  it("counts a tally that has run past the field as done", () => {
    // A scratch after a finish can leave done above total; that is still done.
    expect(idleFieldState(4, 3, false)).toBe("all-done");
  });

  it("waits while there are athletes still to run", () => {
    expect(idleFieldState(1, 3, false)).toBe("waiting");
  });
});

describe("awaitingRun", () => {
  // The timing controls had their own narrower copy of this — "not finished and
  // not scratched" — so a dq, dnp or absent athlete stayed at the head of the
  // queue the Start card pointed at while currentAthlete beside it had already
  // moved on. Same rule, one place.
  it("says yes to anybody still due a turn", () => {
    for (const status of ["queued", "waiting", "up_next", "on_deck", "running", "delayed"]) {
      expect(awaitingRun(ep(1, status)), status).toBe(true);
    }
  });

  it.each(["finished", "scratched", "dq", "dnp", "absent"])("says no to a %s athlete", (status) => {
    expect(awaitingRun(ep(1, status))).toBe(false);
  });

  it("treats a missing status as queued, the way currentAthlete does", () => {
    expect(awaitingRun({ participation_status: null })).toBe(true);
  });

  it("agrees with currentAthlete about who is next", () => {
    const parts = [ep(1, "dq"), ep(2, "scratched"), ep(3, "waiting")];
    expect(parts.filter(awaitingRun)[0]).toBe(currentAthlete(parts).athlete);
  });
});
