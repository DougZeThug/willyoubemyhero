// Server-function stubbing for the browser.
//
// The app reaches its data through `/_serverFn/<id>` RPCs issued from the page,
// so intercepting that one route is enough to drive every screen from fixed
// data — no Supabase, no Docker, no seeded project, and no chance of a test run
// touching the live database. What stays real is everything worth testing in a
// browser: routing, SSR and hydration, the query cache, IndexedDB, localStorage,
// and the components themselves.
//
// Grants and RPC behaviour are covered against real Postgres in tests/db.
import { test as base, expect, type Page, type Route } from "@playwright/test";
import { toCrossJSONAsync } from "seroval";

export const EVENT_ID = "00000000-0000-4000-8000-0000000000ff";

export const PLAYERS = [
  { ep: "ep-alice", pid: "p-alice", name: "Alice Ace", timeMs: 50_000 },
  { ep: "ep-bob", pid: "p-bob", name: "Bob Blitz", timeMs: 60_000 },
  { ep: "ep-carol", pid: "p-carol", name: "Carol Crush", timeMs: 70_000 },
  { ep: "ep-dave", pid: "p-dave", name: "Dave Dnf", timeMs: null },
];

const STATION = { id: "st-1", name: "Sled Push", short_name: "SLED", station_order: 1 };

function eventParticipant(p: (typeof PLAYERS)[number], i: number) {
  return {
    id: p.ep,
    event_id: EVENT_ID,
    participant_id: p.pid,
    participation_status: p.timeMs == null ? "scratched" : "finished",
    card_rarity: null,
    running_order: i + 1,
    bib_number: i + 1,
    photo_path: null,
    card_path: null,
    card_back_path: null,
    selected_draft_position: null,
    participant: {
      id: p.pid,
      name: p.name,
      nickname: null,
      fantasy_team_name: null,
      trash_talk_quote: null,
      bio: null,
      profile_image_url: null,
    },
  };
}

function run(p: (typeof PLAYERS)[number]) {
  return {
    id: `run-${p.pid}`,
    event_id: EVENT_ID,
    participant_id: p.pid,
    official_time_ms: p.timeMs,
    raw_time_ms: p.timeMs,
    is_official: true,
    status: "official",
    attempt_number: 1,
  };
}

/** The full event bundle every page reads from. */
export const BUNDLE = {
  event: { id: EVENT_ID, name: "Draft Combine", year: 2026, active: true, status: "live" },
  participants: PLAYERS.map(eventParticipant),
  stations: [STATION],
  runs: PLAYERS.filter((p) => p.timeMs != null).map(run),
  splits: PLAYERS.filter((p) => p.timeMs != null).map((p) => ({
    id: `sp-${p.pid}`,
    run_id: `run-${p.pid}`,
    station_id: STATION.id,
    segment_time_ms: (p.timeMs ?? 0) / 2,
    cumulative_time_ms: (p.timeMs ?? 0) / 2,
  })),
  penalties: [],
  drafts: [],
};

/**
 * Default responses, keyed by the substring of the RPC id to match.
 *
 * Server function ids are generated from the source file and export name, so
 * matching on the export name is stable across builds without depending on the
 * exact hashing scheme.
 */
export type Responses = Record<string, unknown>;

/**
 * Two rules govern every key below, because the lookup is a case-insensitive
 * `includes` over insertion order (see `matches`):
 *
 *  1. No key may be a substring of another key.
 *  2. No new server-function export name may contain an unrelated key.
 *
 * Break either and the wrong stub answers. And a *missing* stub is worse than a
 * loud failure: an unmatched name falls through to `result: null` with a 200, so
 * the screen renders its empty state and the test passes for the wrong reason.
 */
export const DEFAULT_RESPONSES: Responses = {
  getActiveEvent: BUNDLE.event,
  getEventBundle: BUNDLE,
  getEventSocial: { reactions: [], comments: [] },
  getAwards: [],
  getEventCardUrls: {},
  // No universal back by default, so the sealed pack renders its wax-foil
  // fallback. Does not collide with getEventCardUrls above: the stub matcher is
  // a substring test and neither name contains the other.
  getEventCardBack: { url: null },
  getEventPhotoUrls: {},
  getAllParticipants: PLAYERS.map((p) => ({ id: p.pid, name: p.name, nickname: null })),
  getAllTimeRecords: [],
  getClaimRoster: PLAYERS.map((p) => ({
    id: p.pid,
    name: p.name,
    nickname: null,
    hasCode: true,
    claimed: false,
  })),
  getMyAwardVotes: [],
  // Secret cards. Off by default: a visitor with no member token gets no drop,
  // which is what every existing pack test runs as.
  getSecretStatus: {
    claimed: false,
    day: null,
    pulledToday: false,
    pulled: 0,
    available: false,
    resetsAt: null,
  },
  getMySecrets: { cards: [], pulled: 0 },
  pullSecretCard: { ok: false, reason: "unavailable" },
  listSecretCards: { cards: [], claimedMembers: 0, exhausted: false },
  // Empty by default, so packedByLabel renders nothing and no existing spec
  // has to know this feature exists.
  getCardPullCounts: {},
  recordCardPulls: { ok: true, recorded: 0 },
};

/** A secret card as pullSecretCard returns it, for tests that want the fourth slot. */
export const SECRET_CARD = {
  id: "secret-gary",
  name: "Gary The Grill",
  flavour: "Lit at 11am. Still going at 11pm.",
  foil: "rosette",
  artUrl: null,
  backUrl: null,
};

/**
 * The path segment after `/_serverFn/` is base64url JSON, e.g.
 * `{"file":"/src/lib/event.functions.ts?tss-serverfn-split",
 *   "export":"getActiveEvent_createServerFn_handler"}`
 * so the export name has to be decoded out rather than matched in the raw url.
 */
export function serverFnName(url: string): string {
  const id = new URL(url).pathname.split("/_serverFn/")[1] ?? "";
  try {
    const json = Buffer.from(id, "base64url").toString("utf8");
    return String(JSON.parse(json).export ?? id);
  } catch {
    return id;
  }
}

function matches(name: string, key: string) {
  return name.toLowerCase().includes(key.toLowerCase());
}

// TanStack Start does not send plain JSON over the wire: a server-function
// response is seroval cross-JSON, flagged with `x-tss-serialized` so the client
// knows to run it through fromCrossJSON. A plain JSON.stringify body parses to
// undefined and every screen silently renders its empty state, so the stub has
// to speak the same encoding.
const SERIALIZED_HEADER = "x-tss-serialized";

async function serialize(value: unknown): Promise<string> {
  return JSON.stringify(await toCrossJSONAsync(value, { refs: new Map() }));
}

export type ServerFnMock = {
  /** Override or add a response for one server function. */
  set: (key: string, value: unknown) => void;
  /** Fail one server function with an error the UI has to handle. */
  fail: (key: string, message: string) => void;
  /** Every server function the page called, in order. */
  calls: string[];
};

export async function stubServerFns(page: Page): Promise<ServerFnMock> {
  const responses: Responses = { ...DEFAULT_RESPONSES };
  const failures: Record<string, string> = {};
  const calls: string[] = [];

  await page.route("**/_serverFn/**", async (route: Route) => {
    const name = serverFnName(route.request().url());
    calls.push(name);

    const failureKey = Object.keys(failures).find((k) => matches(name, k));
    if (failureKey) {
      await route.fulfill({
        status: 500,
        headers: { "content-type": "application/json", [SERIALIZED_HEADER]: "true" },
        body: await serialize({ error: new Error(failures[failureKey]) }),
      });
      return;
    }

    const key = Object.keys(responses).find((k) => matches(name, k));
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/json", [SERIALIZED_HEADER]: "true" },
      body: await serialize({ result: key ? responses[key] : null }),
    });
  });

  return {
    set: (key, value) => {
      responses[key] = value;
    },
    fail: (key, message) => {
      failures[key] = message;
    },
    calls,
  };
}

export const test = base.extend<{ server: ServerFnMock; consoleErrors: string[] }>({
  // `auto` matters. Playwright only builds a fixture a test actually
  // destructures, so a test taking just `{ page }` would run with no stubbing at
  // all, hit the real backend, and fail with an empty page rather than an
  // obvious connection error. Every test gets the stub whether it names it or not.
  server: [
    async ({ page }, use) => {
      await use(await stubServerFns(page));
    },
    { auto: true },
  ],
  // Surfaced as a fixture rather than asserted automatically, so a test that
  // expects an error can opt in to ignoring it.
  consoleErrors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(String(err)));
    await use(errors);
  },
});

export { expect };
