// Builders for the event bundle that card-rarity, card-stats and the live views
// all read from. The shapes here are the structural types those modules already
// declare (RarityBundle, StatsBundle) plus the participant join that
// getEventBundle actually returns, so one fixture feeds every consumer.
//
// Ids are deterministic and sequential. Call `resetFixtureIds()` in a beforeEach
// so a failing test reports the same ids every run.

let counter = 0;

export function resetFixtureIds() {
  counter = 0;
}

/** A valid v4-shaped uuid, so zod's `.uuid()` accepts it in server-fn tests. */
export function uuid(n?: number): string {
  const i = n ?? ++counter;
  return `00000000-0000-4000-8000-${i.toString(16).padStart(12, "0")}`;
}

export type FixtureParticipant = {
  id: string;
  event_id: string;
  participant_id: string;
  participation_status: string;
  card_rarity: string | null;
  running_order: number;
  bib_number: number | null;
  photo_path: string | null;
  card_path: string | null;
  card_back_path: string | null;
  selected_draft_position: number | null;
  participant: { id: string; name: string; nickname: string | null } | null;
};

export type FixtureRun = {
  id: string;
  event_id: string;
  participant_id: string;
  official_time_ms: number | null;
  raw_time_ms: number | null;
  is_official: boolean;
  status: string;
  attempt_number: number;
  client_key: string;
};

export type FixtureStation = {
  id: string;
  event_id: string;
  name: string;
  short_name: string | null;
  station_order: number;
};

export type FixtureSplit = {
  id: string;
  run_id: string;
  station_id: string;
  segment_time_ms: number | null;
  cumulative_time_ms: number | null;
};

export type FixturePenalty = {
  id: string;
  run_id: string;
  station_id: string | null;
  penalty_ms: number;
  reason: string | null;
};

export type FixtureBundle = {
  event: { id: string; name: string; year: number; active: boolean } | null;
  participants: FixtureParticipant[];
  stations: FixtureStation[];
  runs: FixtureRun[];
  splits: FixtureSplit[];
  penalties: FixturePenalty[];
  drafts: unknown[];
};

export const EVENT_ID = "00000000-0000-4000-8000-0000000000ff";

export function makeParticipant(over: Partial<FixtureParticipant> = {}): FixtureParticipant {
  const id = over.id ?? uuid();
  const participantId = over.participant_id ?? uuid();
  return {
    id,
    event_id: EVENT_ID,
    participant_id: participantId,
    participation_status: "queued",
    card_rarity: null,
    running_order: 1,
    bib_number: null,
    photo_path: null,
    card_path: null,
    card_back_path: null,
    selected_draft_position: null,
    participant: { id: participantId, name: "Athlete", nickname: null },
    ...over,
  };
}

export function makeRun(over: Partial<FixtureRun> = {}): FixtureRun {
  const id = over.id ?? uuid();
  return {
    id,
    event_id: EVENT_ID,
    participant_id: over.participant_id ?? uuid(),
    official_time_ms: 60_000,
    raw_time_ms: 60_000,
    is_official: true,
    status: "official",
    attempt_number: 1,
    client_key: `ck-${id}`,
    ...over,
  };
}

export function makeStation(over: Partial<FixtureStation> = {}): FixtureStation {
  return {
    id: over.id ?? uuid(),
    event_id: EVENT_ID,
    name: "Station",
    short_name: null,
    station_order: 1,
    ...over,
  };
}

export function makeSplit(over: Partial<FixtureSplit> = {}): FixtureSplit {
  return {
    id: over.id ?? uuid(),
    run_id: over.run_id ?? uuid(),
    station_id: over.station_id ?? uuid(),
    segment_time_ms: 10_000,
    cumulative_time_ms: 10_000,
    ...over,
  };
}

export function makePenalty(over: Partial<FixturePenalty> = {}): FixturePenalty {
  return {
    id: over.id ?? uuid(),
    run_id: over.run_id ?? uuid(),
    station_id: null,
    penalty_ms: 5_000,
    reason: null,
    ...over,
  };
}

export function makeBundle(over: Partial<FixtureBundle> = {}): FixtureBundle {
  return {
    event: { id: EVENT_ID, name: "Draft Combine", year: 2026, active: true },
    participants: [],
    stations: [],
    runs: [],
    splits: [],
    penalties: [],
    drafts: [],
    ...over,
  };
}

/**
 * A five-player field that exercises the placing tiers at once.
 *
 * - alice  50s, fastest overall              → champion
 * - bob    60s, second                       → podium
 * - erin   70s, third                        → podium
 * - carol  90s, fourth, owns the fastest split at station A → stationKing
 * - dave   scratched, never ran              → dnf
 *
 * Carol has to finish off the podium for her station win to be the tier that
 * shows: placing outranks a station split. penaltyBox is asserted separately,
 * since any placing at all outranks it too.
 */
export function makeFieldBundle() {
  const stationA = makeStation({ id: uuid(), name: "Sled Push", short_name: "SLED", station_order: 1 }); // prettier-ignore
  const stationB = makeStation({ id: uuid(), name: "Beer Mile", short_name: "BEER", station_order: 2 }); // prettier-ignore

  const alice = makeParticipant({ participant: { id: uuid(), name: "Alice", nickname: null } });
  const bob = makeParticipant({ participant: { id: uuid(), name: "Bob", nickname: null } });
  const erin = makeParticipant({ participant: { id: uuid(), name: "Erin", nickname: null } });
  const carol = makeParticipant({ participant: { id: uuid(), name: "Carol", nickname: null } });
  const dave = makeParticipant({
    participation_status: "scratched",
    participant: { id: uuid(), name: "Dave", nickname: null },
  });

  const aliceRun = makeRun({ participant_id: alice.participant_id, official_time_ms: 50_000 });
  const bobRun = makeRun({ participant_id: bob.participant_id, official_time_ms: 60_000 });
  const erinRun = makeRun({ participant_id: erin.participant_id, official_time_ms: 70_000 });
  const carolRun = makeRun({ participant_id: carol.participant_id, official_time_ms: 90_000 });

  return {
    stationA,
    stationB,
    alice,
    bob,
    erin,
    carol,
    dave,
    aliceRun,
    bobRun,
    erinRun,
    carolRun,
    bundle: makeBundle({
      participants: [alice, bob, erin, carol, dave],
      stations: [stationA, stationB],
      runs: [aliceRun, bobRun, erinRun, carolRun],
      splits: [
        makeSplit({ run_id: aliceRun.id, station_id: stationA.id, segment_time_ms: 20_000 }),
        makeSplit({ run_id: aliceRun.id, station_id: stationB.id, segment_time_ms: 30_000 }),
        makeSplit({ run_id: bobRun.id, station_id: stationA.id, segment_time_ms: 25_000 }),
        makeSplit({ run_id: bobRun.id, station_id: stationB.id, segment_time_ms: 35_000 }),
        makeSplit({ run_id: erinRun.id, station_id: stationA.id, segment_time_ms: 30_000 }),
        makeSplit({ run_id: erinRun.id, station_id: stationB.id, segment_time_ms: 40_000 }),
        // Carol is slowest overall but fastest at station A — the station king.
        makeSplit({ run_id: carolRun.id, station_id: stationA.id, segment_time_ms: 10_000 }),
        makeSplit({ run_id: carolRun.id, station_id: stationB.id, segment_time_ms: 80_000 }),
      ],
      penalties: [],
    }),
  };
}
