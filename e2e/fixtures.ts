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
    on_clock_since: null,
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
  failed: [],
};

/**
 * Default responses, keyed by the substring of the RPC id to match.
 *
 * Server function ids are generated from the source file and export name, so
 * matching on the export name is stable across builds without depending on the
 * exact hashing scheme.
 */
export type Responses = Record<string, unknown>;

function matches(name: string, key: string) {
  return name.toLowerCase().includes(key.toLowerCase());
}

/**
 * Rule 1 below, enforced rather than asked for.
 *
 * `matches` is a substring test resolved in insertion order, so a key that
 * contains another key shadows it. The symptom is a screen rendering some other
 * function's data, which reads as a product bug rather than a fixture one, and
 * refusing to start is far cheaper than debugging that from a screenshot.
 *
 * Runs over DEFAULT_RESPONSES at module load and over the merged set on every
 * `set`, because a test can add a key too.
 */
function assertDistinctKeys(responses: Responses, added?: string) {
  const keys = Object.keys(responses);
  for (const key of added === undefined ? keys : [added]) {
    for (const other of keys) {
      if (other === key) continue;
      if (!matches(key, other) && !matches(other, key)) continue;
      const [wider, narrower] = matches(key, other) ? [key, other] : [other, key];
      throw new Error(
        `e2e stub: "${narrower}" is a substring of "${wider}", so whichever of the two comes ` +
          `first answers for both. Rename one of them.`,
      );
    }
  }
}

/**
 * Two rules govern every key below, because the lookup is a case-insensitive
 * `includes` over insertion order (see `matches`):
 *
 *  1. No key may be a substring of another key. `assertDistinctKeys` enforces
 *     this one — break it and the suite refuses to start.
 *  2. No new server-function export name may contain an unrelated key. Nothing
 *     here can check that: the export names live in src/lib/*.functions.ts and
 *     only the running app knows which of them a screen reaches for. Still a
 *     rule you hold to by hand.
 *
 * A *missing* stub used to be the worse failure of the two because it was
 * silent: an unmatched name fell through to `result: null` with a 200, the
 * screen rendered its empty state, and the test passed for the wrong reason. It
 * answers 500 and fails the test now — see `stubServerFns`.
 */
/** The anonymous identity every unclaimed visitor in this suite pulls as. */
const GUEST_ID = "00000000-0000-4000-8000-0000000000e1";
const GUEST_EXPIRES = Date.now() + 90 * 24 * 60 * 60 * 1000;

/**
 * Today in the league's zone, exactly as `leagueDay()` in src/lib/trades.ts
 * computes it — the same Intl formula, because the pack row is keyed on this
 * and a stub that answered a different day would leave every resume test
 * looking at a row the route calls yesterday's.
 */
export function leagueDayAt(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}
export const LEAGUE_DAY = leagueDayAt(new Date());

/** A secret card as `openPack` hands one over, for tests that want one in the pack. */
export const SECRET_CARD = {
  id: "secret-gary",
  name: "Gary The Grill",
  flavour: "Lit at 11am. Still going at 11pm.",
  foil: "rosette",
  borderFx: "spin",
  collection: null,
  artUrl: null,
  backUrl: null,
  tier: "common",
};

/** A roster slot as the server deals one to a member: held zero times, standard. */
export const rosterSlot = (ep: string, over: Record<string, unknown> = {}) => ({
  kind: "roster",
  id: ep,
  edition: "standard",
  heldBefore: 0,
  editionBefore: null,
  ...over,
});

/** A secret slot: a first pull, at the card's own level, finishing nothing. */
export const secretSlot = (over: Record<string, unknown> = {}) => ({
  kind: "secret",
  id: SECRET_CARD.id,
  card: SECRET_CARD,
  duplicate: false,
  tierBefore: null,
  completedCollection: null,
  ...over,
});

/** The pack every spec opens unless it says otherwise: three roster cards, no secret. */
export const DEFAULT_PACK = [rosterSlot("ep-alice"), rosterSlot("ep-bob"), rosterSlot("ep-carol")];
/** Roster ids in dealt order, for the specs that read the pack row back. */
export const DEFAULT_PACK_IDS = DEFAULT_PACK.map((s) => s.id);

/** What `openPack` answers: a fresh deal of `cards` on today's league day. */
export const packResponse = (
  cards: unknown[] = DEFAULT_PACK,
  over: Record<string, unknown> = {},
) => ({
  ok: true,
  day: LEAGUE_DAY,
  fresh: true,
  packsOpened: 1,
  cards,
  ...over,
});

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
    reachable: false,
  })),
  getMyAwardVotes: [],
  // A guest identity is minted on the pack screen so an unclaimed visitor can be
  // dealt a pack. The token only has to satisfy the client's parse — four parts,
  // a "g" prefix and a future expiry — because the signature is checked on the
  // server, which is stubbed out here anyway. Without a storable token the client
  // never resolves an actor and the wrapper is never tearable.
  startGuestSession: {
    ok: true,
    guestId: GUEST_ID,
    token: `g.${GUEST_ID}.${GUEST_EXPIRES}.e2e-signature`,
    expiresAt: GUEST_EXPIRES,
  },
  // The pack. Sealed by default, and dealt as three roster cards with nothing
  // special about them, so no existing spec has to know a secret can be in it.
  // Static, so every call answers `fresh: true` — the route recognises a resume
  // by the row it holds, not by this flag. `getPackStatus` and `openPack` are
  // neither substrings of each other nor of any key here; assertDistinctKeys
  // checks.
  getPackStatus: {
    claimed: true,
    day: LEAGUE_DAY,
    openedToday: false,
    secretsOwned: 0,
    resetsAt: `${LEAGUE_DAY}T04:00:00Z`,
  },
  openPack: packResponse(),
  getMySecrets: { cards: [], pulled: 0 },
  // Streaks. Zero by default, so the flame and the summary's claim block render
  // nothing and no existing pack spec has to know this feature exists. Neither
  // key is a substring of another key here — check that again before adding one.
  //
  // claimStreakMilestone is deliberately NOT defaulted, for the same reason the
  // trade mutations below are not: nothing should reach it unless a test means
  // to, and an undefaulted handler falls through rather than quietly succeeding.
  getStreakStatus: {
    kind: null,
    current: 0,
    startedOn: null,
    lastOpenedOn: null,
    openedToday: false,
    today: "2026-08-24",
    canClaim: false,
    milestones: [],
  },
  // Empty by default: nobody has cashed a rung in the fixture, so /you renders
  // the ladder and no history. "getStreakHistory" and "getStreakStatus" are
  // neither one a substring of the other, which is what the rule above wants.
  getStreakHistory: [],
  listSecretCards: { cards: [], claimedMembers: 0, exhausted: false },
  // Empty by default, so packedByLabel renders nothing and no existing spec
  // has to know this feature exists.
  getCardPullCounts: {},
  // Trading. Empty by default for the same reason: /players/trade renders its
  // "nobody wants your cards yet" state and the vault's Trade pill leads
  // somewhere harmless. None of these three keys is a substring of another or of
  // any key above — check that again before adding a fourth.
  //
  // The mutating handlers (createTradeOffer, acceptTradeOffer, decline/cancel)
  // are deliberately NOT defaulted: nothing reaches them unless a test means to,
  // and e2e/trades.spec.ts stubs each one where it exercises it, so the stub
  // reads next to the assertion it feeds.
  // `nudgeTopic` is null on purpose. A topic string here would have SiteNav open a
  // realtime websocket to the live Supabase URL on every page in the suite, which
  // is both the one thing these stubs exist to prevent and a console error
  // smoke.spec.ts asserts against.
  getMyTradeOffers: { inbox: [], outbox: [], recent: [], nudgeTopic: null },
  // `roster` is one entry per COPY — {copyId, eventParticipantId, edition} — since
  // a trade moves a specific copy and its finish. `secrets` is one entry per
  // secret_card_pulls row, which is what the shop sells from. Empty here either
  // way, so no existing spec has to know either feature exists.
  getTradeSpares: { participantId: null, ownedRoster: [], roster: [], secrets: [], blocked: [] },
  getTradeFeed: [],
  // The marketplace. Empty by default so /players/shop renders its "nothing for
  // sale right now" state and no existing spec has to know the feature exists.
  // `getMarketListings` and `getMyStall` are not substrings of each other or of
  // any key above — the rule the trading block states, which now has to hold
  // across seven keys rather than three.
  //
  // The mutating handlers (listCardForDust, buyMarketListing,
  // cancelMarketListing) are deliberately NOT defaulted, for the same reason the
  // trade ones are not: nothing reaches them unless a test means to.
  //
  // `nudgeTopic` is null for exactly the reason getMyTradeOffers' is — and it
  // matters more here, because /players/shop joins this topic itself.
  getMarketListings: { listings: [], nudgeTopic: null },
  getMyStall: { active: [], recent: [] },
  // The trophy shelf, and the set names it prints. Empty by default: nobody in
  // this league has finished a set, so there is no shelf, no card-back badge and
  // no ceremony, and no existing spec has to know the feature exists. Neither
  // key is a substring of any other above — `assertDistinctKeys` checks.
  getCollectionTrophies: { trophies: [] },
  getSecretCollections: { collections: [] },
  // `null` on purpose, and the one entry here that is not a shaped response.
  //
  // useMyCollection reads a null answer as "the server has no opinion" and hands
  // this device's local rows back untouched, which is the state every spec that
  // deals a pack was written against. The shaped empty answer — `{ cards: [] }` —
  // is the server saying "you own nothing", and that PRUNES the cards the pack
  // just dealt. A test that wants the server to have an opinion sets one, the
  // way favourites.spec.ts does.
  getMyCardStats: null,
  // What arrived since this device last looked (§12). Empty by default, so the
  // "new since" strip inside the Today card is hidden and no existing spec has to
  // know the feature exists. `getRecentAcquisitions` is neither a substring of any
  // key above nor a superset of one — assertDistinctKeys checks, and the rule now
  // has to hold across every key in this object.
  getRecentAcquisitions: { roster: [], secrets: [] },
};

assertDistinctKeys(DEFAULT_RESPONSES);

/** The sealed pack control on /players/pack. */
export const sealedPack = (page: Page) => page.getByRole("button", { name: /tear the pack open/i });

/**
 * The one way any spec opens the pack.
 *
 * The app's tear handler — `tearOpen` in src/routes/players.pack.tsx — refuses
 * while the collection is still being reconciled, because a guest's "held
 * before" is read off it at the deal. And it refuses *silently*, so
 * a test that presses Enter too early gets a pack that stays sealed and an
 * assertion that times out somewhere unrelated. The Collected counter is the
 * one thing on the screen that says so out loud: it reads a dash until the
 * reconcile lands. On a loaded CI runner the stubs can answer *after* the
 * keypress, so the wait is fused to the press rather than left to each test to
 * remember. The one exception is the fake-clock test in journeys, which keeps
 * its own press-until-it-takes loop: under an installed clock this wait and
 * the reconcile would deadlock on each other.
 */
export async function tearPack(page: Page) {
  await expect(page.getByTestId("collected-count")).not.toHaveText(/—/);
  await sealedPack(page).press("Enter");
}

/** The card currently on the reveal stand. */
export const standCard = (page: Page) => page.locator('[role="button"][aria-pressed]').first();

/** One leftward throw across the card, in as few round trips as it can be done. */
async function throwCardLeft(page: Page) {
  const box = (await standCard(page).boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.85, y);
  await page.mouse.down();
  // One move, not four. Only the pointerdown and pointerup coordinates decide
  // the swipe — the stand binds down/up/cancel and never reads pointermove
  // (pack-stand.tsx:598-614) — so interpolated steps change `dx` not at all and
  // `ms` a great deal. Each one is a round trip, and each one also runs
  // holo-card's pointermove (holo-card.tsx:531-546), forcing a layout read and
  // a rAF tilt write, all of it inside the 700ms being measured.
  await page.mouse.move(box.x + box.width * 0.15, y);
  await page.mouse.up();
}

/**
 * Turn the card on the stand, pressing until it takes.
 *
 * The tap's own version of what `swipeNext` handles for the throw, and swallowed
 * for a related reason: `revealAt` holds a re-entrancy latch for the whole of
 * the previous card's celebration (players.pack.tsx:883), so a tap that lands
 * while confetti is still in the air does nothing at all — and nothing says so.
 * A bare click then leaves the card face-down and whatever the test asserts next
 * waits out its timeout for a reveal that was never started.
 *
 * The hint is the signal rather than `aria-pressed`: the stand's own copy is
 * "tap for the back" once a card has turned, so aria-pressed is only good enough
 * to say "not currently showing its back" — which is why it guards the press
 * rather than ending the loop. Pressing a card that HAS turned would flip it to
 * its back, which is the trap the walk in journeys.spec.ts:540-552 documents.
 */
export async function turnCard(page: Page) {
  const card = standCard(page);
  const hint = page.getByText(/swipe/i).first();
  await expect
    .poll(
      async () => {
        if (await hint.count()) return true;
        if ((await card.getAttribute("aria-pressed")) === "false") await card.click();
        await page.waitForTimeout(400);
        return (await hint.count()) > 0;
      },
      { timeout: 25_000, intervals: [200] },
    )
    .toBe(true);
}

/**
 * Step to the next card the way a thumb does: a fast leftward throw across the
 * revealed card. There is no Next button in the intended flow — the stand reads
 * the gesture with swipeDirection() from src/lib/zoom.ts, which wants >=48px of
 * mostly horizontal travel inside 700ms.
 *
 * Thrown until it takes, because a throw can be dropped two different ways and
 * both are silent — the step just stays where it was and the assertion after it
 * waits out its whole timeout for a number that is never coming.
 *
 * The first way is the gate: pack-stand.tsx:468 ignores a throw when
 * `canAdvance` is false. That one needs no guessing, so it is waited out rather
 * than retried — the stand's own Next control (pack-stand.tsx:962, kept in the
 * tree for a keyboard and merely transparent when off) carries `canAdvance` as
 * `disabled`.
 *
 * The second way is the clock, and it is why waiting on the gate alone was not
 * enough. swipeDirection rejects anything slower than 700ms (zoom.ts:79,83), and
 * the secret's celebration outlives the await that precedes this: celebrateSecret
 * fires two 60-particle cannons and resolves as soon as they are queued
 * (players.pack.tsx:960), so the gate opens while the main thread is still
 * animating them. A throw issued into that can spend its whole budget in transit
 * and be read as "a drag that happened to end off to one side".
 *
 * Hence the loop, and hence its guard: re-throw only while the step has not
 * moved AND the stand is still idle on the same card. `onAdvance()` runs
 * synchronously in the pointerup handler, so a throw that WAS read has already
 * moved the step by the time the next pass looks — a re-throw can therefore only
 * ever follow one that was rejected, and can never step two cards on. Each pass
 * also gets a fresh 700ms against confetti that is decaying.
 */
export async function swipeNext(page: Page) {
  const step = page.getByTestId("stand-step");
  const next = page.getByRole("button", { name: /^next$/i });
  // Null once the stand has handed the screen to the summary, which is a change
  // like any other and is how the last throw of a pack ends this loop. Read in
  // one call rather than count-then-read: the last throw unmounts the stand, and
  // a pair of calls can straddle exactly that.
  const readStep = () => step.textContent({ timeout: 1_000 }).catch(() => null);

  await expect(next).toBeEnabled();
  const before = await readStep();

  await expect
    .poll(
      async () => {
        if ((await readStep()) !== before) return true;
        // Same treatment, and for the same moment: the control goes with the
        // stand, and a bare isEnabled() would block rather than answer.
        const idle = await next.isEnabled({ timeout: 1_000 }).catch(() => false);
        if (idle) await throwCardLeft(page);
        // Long enough that an unmoved step means the throw was really dropped,
        // rather than that React had not committed yet.
        await page.waitForTimeout(300);
        return (await readStep()) !== before;
      },
      { timeout: 20_000, intervals: [200] },
    )
    .toBe(true);
}

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
  /** Stop failing one, so a retry the UI offers has something to succeed at. */
  recover: (key: string) => void;
  /**
   * Hold one server function's answer back, for the races a fast stub hides.
   *
   * Every response here is instant, which quietly makes "the data is already
   * there" the only ordering any test exercises — and the screens this suite
   * covers deal cards and run reveal animations while requests are still out.
   */
  delay: (key: string, ms: number) => void;
  /**
   * Answer an unstubbed server function with `result: null` again, the way this
   * file used to answer every one of them.
   *
   * The deliberate escape hatch, for a test that means to exercise a call
   * nothing here has an answer for. Call it before the first navigation: it
   * changes what happens next and cannot unsay a 500 already sent.
   */
  allowUnmatched: () => void;
  /** Every server function the page called, in order. */
  calls: string[];
  /** The unstubbed calls this mock refused. Drained by the `server` fixture. */
  unmatched: string[];
};

/**
 * Every mock alive in the current test, the ones a spec builds by hand for a
 * second tab included — journeys.spec.ts opens three. The `server` fixture
 * drains this on teardown, so an unstubbed call fails the test whichever page
 * made it, not only the page the fixture owns.
 *
 * Module state is safe here because a worker runs one test at a time.
 */
const liveMocks = new Set<ServerFnMock>();

export async function stubServerFns(
  page: Page,
  onUnmatched?: (message: string) => void,
): Promise<ServerFnMock> {
  const responses: Responses = { ...DEFAULT_RESPONSES };
  const failures: Record<string, string> = {};
  const delays: Record<string, number> = {};
  const calls: string[] = [];
  const unmatched: string[] = [];
  let unmatchedAllowed = false;

  await page.route("**/_serverFn/**", async (route: Route) => {
    const name = serverFnName(route.request().url());
    calls.push(name);

    const delayKey = Object.keys(delays).find((k) => matches(name, k));
    if (delayKey) await new Promise((r) => setTimeout(r, delays[delayKey]));

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
    if (key === undefined && !unmatchedAllowed) {
      // Loud three ways over, because no one of them catches every test: the 500
      // breaks whichever screen was waiting on the answer, the console line
      // fails smoke.spec.ts's clean-console assertion, and the teardown check in
      // the `server` fixture fails everything else — which is nearly all of
      // them, since smoke.spec.ts's route sweep is the only place in the suite
      // that asks for `consoleErrors` at all.
      //
      // Plain text rather than the serialized error `fail` sends: that one is
      // shaped for a UI error path to swallow gracefully, and this is the case
      // where swallowing it is the bug.
      const message =
        `e2e stub: nothing answers "${name}". Add a key to DEFAULT_RESPONSES in ` +
        `e2e/fixtures.ts, call server.set() in the test, or server.allowUnmatched() if the ` +
        `call is meant to go unstubbed. Known keys: ${Object.keys(responses).join(", ")}`;
      unmatched.push(message);
      onUnmatched?.(message);
      await route.fulfill({
        status: 500,
        headers: { "content-type": "text/plain" },
        body: message,
      });
      return;
    }

    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/json", [SERIALIZED_HEADER]: "true" },
      body: await serialize({ result: key ? responses[key] : null }),
    });
  });

  const mock: ServerFnMock = {
    set: (key, value) => {
      // Rule 1 again. A test can add a key, and one that collides with a default
      // would shadow it rather than override it — which looks like the override
      // simply not working.
      assertDistinctKeys({ ...responses, [key]: value }, key);
      responses[key] = value;
    },
    fail: (key, message) => {
      failures[key] = message;
    },
    recover: (key) => {
      delete failures[key];
    },
    delay: (key, ms) => {
      delays[key] = ms;
    },
    allowUnmatched: () => {
      unmatchedAllowed = true;
    },
    calls,
    unmatched,
  };
  liveMocks.add(mock);
  return mock;
}

export const test = base.extend<{ server: ServerFnMock; consoleErrors: string[] }>({
  // `auto` matters. Playwright only builds a fixture a test actually
  // destructures, so a test taking just `{ page }` would run with no stubbing at
  // all, hit the real backend, and fail with an empty page rather than an
  // obvious connection error. Every test gets the stub whether it names it or not.
  // It takes `consoleErrors` so that fixture is built for every test too: an
  // unstubbed call has to land somewhere the test can see it, and only
  // smoke.spec.ts asks for the array by name.
  server: [
    async ({ page, consoleErrors }, use) => {
      liveMocks.clear();
      const mock = await stubServerFns(page, (message) => consoleErrors.push(message));
      await use(mock);
      // In teardown, so an unstubbed call fails the test even when the screen
      // shrugged the 500 off and the test never looked at `consoleErrors`. Over
      // every mock in the test rather than this one, so a second tab counts.
      const missed = [...liveMocks].flatMap((m) => m.unmatched);
      liveMocks.clear();
      if (missed.length) throw new Error([...new Set(missed)].join("\n"));
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
