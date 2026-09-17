// Every public route renders, hydrates, and survives having no data.
import type { Locator, Page } from "@playwright/test";
import {
  test,
  expect,
  BUNDLE,
  EVENT_ID,
  PLAYERS,
  SECRET_CARD,
  sealedPack,
  tearPack,
  type ServerFnMock,
} from "./fixtures";

const ROUTES = [
  { path: "/", title: /Draft Combine|Hero/i },
  { path: "/live", title: /Live/i },
  { path: "/leaderboard", title: /Leaderboard/i },
  { path: "/players", title: /Vault|Players/i },
  // An anonymous visit to the Trading Post is a redirect to /claim by design —
  // most people arriving here hold a paper code and need no account. What this
  // entry is still worth is the rest of the sweep: a real response, a body that
  // survived hydration, and a clean console. The Trading Post itself is covered
  // by e2e/trades.spec.ts, signed in and out.
  { path: "/players/trade", title: /Claim Your Player/i },
  { path: "/players/shop", title: /Dust/i },
  { path: "/awards", title: /Awards/i },
  { path: "/league", title: /League/i },
  { path: "/claim", title: /Claim/i },
  // No tab lights it — it hangs off the header's person icon — so this is the
  // only place the render sweep sees it at all.
  { path: "/you", title: /You/i },
  // These three render the same data the rest do and were simply missed.
  { path: "/analytics", title: /Analytics/i },
  { path: "/tv", title: /TV|Board|Combine/i },
  // And so were these two, for three passes. Both are public, both are in
  // sitemap.xml, and neither had the stated reason /admin and /recap/$slug have
  // — they were never added. The third pass's render set found a 36px link on
  // /draft and four clipped names on /order the first time anything looked.
  { path: "/draft", title: /Draft/i },
  { path: "/order", title: /Order/i },
  // /recap/$slug is not in this list on purpose: its loader runs during the SSR
  // render, where the browser-side stub cannot reach it, so a direct visit is a
  // genuine 404 against a dead Supabase. It is covered below by walking to it
  // the way a reader does.
];

test.describe("smoke", () => {
  for (const route of ROUTES) {
    test(`${route.path} renders`, async ({ page, server, consoleErrors }) => {
      void server;
      const response = await page.goto(route.path);
      expect(response?.status()).toBeLessThan(400);
      await expect(page).toHaveTitle(route.title);
      // The app shell always renders; a blank body means hydration died.
      await expect(page.locator("body")).not.toBeEmpty();

      expect(
        consoleErrors.filter(
          // Fonts are fetched from Google and the sandbox has no egress.
          (e) => !/fonts\.googleapis|net::ERR|Failed to load resource/i.test(e),
        ),
      ).toEqual([]);
    });
  }

  test("an event with no data at all still renders rather than crashing", async ({
    page,
    server,
  }) => {
    server.set("getActiveEvent", null);
    server.set("getEventBundle", {
      event: null,
      participants: [],
      stations: [],
      runs: [],
      splits: [],
      penalties: [],
      drafts: [],
    });
    await page.goto("/leaderboard");
    await expect(page.locator("body")).not.toBeEmpty();
  });

  test("a failing server function does not blank the page", async ({ page, server }) => {
    server.fail("getEventBundle", "boom");
    await page.goto("/live");
    await expect(page.locator("body")).not.toBeEmpty();
  });

  test("says which page you are on, rather than only colouring it", async ({ page, server }) => {
    // The scripted verification pass probed for this and found nothing: the
    // active tab was a colour class and nothing else, so the current page was
    // not exposed programmatically anywhere in the app.
    void server;
    await page.goto("/leaderboard");
    // Both navs mark the current page — the top bar and the phone's bottom bar —
    // and exactly one of them is on screen at a given width, so `:visible` is
    // what makes this one assertion true in both projects.
    const current = page.locator('[aria-current="page"]:visible');
    await expect(current).toHaveCount(1);
    await expect(current).toHaveAttribute("href", "/leaderboard");
  });

  test("says so on the profile too, which has no tab to light", async ({ page, server }) => {
    // /you hangs off the header's person icon rather than the bar, and the bar
    // is deliberately the commissioner's to shape — so the icon is what carries
    // "you are here". Without this the app had one screen that answered nothing.
    void server;
    await page.goto("/you");
    const current = page.locator('[aria-current="page"]:visible');
    await expect(current).toHaveCount(1);
    await expect(current).toHaveAttribute("href", "/you");
  });

  test("puts a skip link ahead of the whole nav", async ({ page, server }) => {
    void server;
    await page.goto("/leaderboard");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: /skip to content/i })).toBeFocused();
  });

  test("still puts it there when the entry URL redirects", async ({ page, server }) => {
    // "/" is the link people paste, and it only redirects — which used to spend
    // the root's first-render focus guard on the redirect, so the landing at
    // /players counted as a route CHANGE and focus was moved into main before
    // anybody had pressed a key. The skip link was then unreachable on the one
    // entry that matters. The test above cannot see this: /leaderboard renders
    // itself and never moves the pathname.
    void server;
    await page.goto("/");
    await expect(page).toHaveURL(/\/players$/);
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: /skip to content/i })).toBeFocused();
  });

  test("an archived recap renders when you walk to it from the archive", async ({
    page,
    server,
  }) => {
    server.set("listArchives", [
      {
        id: "arch-1",
        slug: "combine-2025",
        event_name: "Draft Combine",
        event_year: 2025,
        created_at: "2025-08-24T12:00:00.000Z",
      },
    ]);
    server.set("getArchivedRecap", {
      slug: "combine-2025",
      snapshot: {
        event: { name: "Draft Combine", year: 2025 },
        participants: [
          { id: "ep-1", participant_id: "p-1", participant: { name: "Doug" } },
          { id: "ep-2", participant_id: "p-2", participant: { name: "Alice" } },
          { id: "ep-3", participant_id: "p-3", participant: { name: "Bob" } },
          { id: "ep-4", participant_id: "p-4", participant: { name: "Carol" } },
        ],
        runs: [
          // Doug was re-timed. The board ranks ATHLETES, so he is one row at his
          // best — ranking the runs put him in two places at once.
          { id: "r-0", participant_id: "p-1", is_official: true, official_time_ms: 70_000 },
          { id: "r-1", participant_id: "p-1", is_official: true, official_time_ms: 61_000 },
          // A dead heat shares its place rather than splitting on sort order.
          { id: "r-2", participant_id: "p-2", is_official: true, official_time_ms: 75_000 },
          { id: "r-3", participant_id: "p-3", is_official: true, official_time_ms: 75_000 },
          // Official with no time recorded: not a place at all, the same way the
          // live board has never given one.
          { id: "r-4", participant_id: "p-4", is_official: true, official_time_ms: null },
        ],
        drafts: [{ selection_order: 1, participant_id: "p-1", draft_position: 1 }],
      },
    });

    await page.goto("/analytics");
    await page.getByRole("link", { name: /Draft Combine 2025/ }).click();
    await expect(page).toHaveURL(/\/recap\/combine-2025$/);
    await expect(page.getByText("1:01.00")).toBeVisible();

    // Scoped to the leaderboard: the draft order below it renders names too.
    const board = page.locator("section", {
      has: page.getByRole("heading", { name: "Final Leaderboard" }),
    });
    await expect(board.locator("li")).toHaveCount(3);
    expect(await board.locator("li > span:nth-child(2)").allTextContents()).toEqual([
      "Doug",
      "Alice",
      "Bob",
    ]);
    // The places, not the row numbers. 1, 2, 2 — never 1, 2, 3.
    expect(await board.locator("li > span:nth-child(1)").allTextContents()).toEqual([
      "1",
      "2",
      "2",
    ]);
  });
});

/**
 * Nothing a thumb can land on is smaller than a thumb (§18 of the mobile audit).
 *
 * Mobile only, and that is the point rather than a shortcut: 44px is a TOUCH
 * guideline, the pointer equivalent is 24px, and this repo already writes the
 * distinction down — vault-section.tsx's move arrows are `h-11 w-11 sm:h-8
 * sm:w-8` on purpose, and the top bar's section links only exist above `md`.
 * Run against the desktop project this would fail two deliberate decisions and
 * prove nothing.
 */
const MIN_TARGET = 44;

/**
 * Everything a thumb can land on. An <a> with no href is not one.
 *
 * The fields joined late (§23 F1): the floor lived in `ui/button.tsx` while
 * `ui/input.tsx` was a bare `h-9`, and this selector is the reason nobody
 * noticed — it measured the buttons around the member code field and never the
 * field itself.
 *
 * `select` and `textarea` are here for the next one rather than for anything
 * they catch today: every one in the app is behind the commissioner's PIN or,
 * for the marshal's athlete-on-deck box, behind `useAdminSession()` on /live,
 * so this sweep cannot reach them. That box was raised by hand alongside this
 * change; a select that lands on a player route from now on is measured.
 *
 * Watch `sr-only`: Playwright counts a 1x1 clipped box as visible, which is why
 * EXEMPT exists below. The only one today is the radio in secret-look-picker,
 * and that is admin-only.
 */
const CONTROLS = 'button, a[href], [role="button"], input, select, textarea';

/**
 * Under 16px iOS Safari zooms the page when a field takes focus, and zooms it
 * around the caret rather than back out again afterwards.
 *
 * Its own rule and its own sweep rather than a second column on the one above:
 * a field can be tall enough and still 14px, and a failure should say which of
 * the two broke.
 *
 * `ui/textarea.tsx` still carries the `md:text-sm` this PR took off `Input`. It
 * is out of scope because every <Textarea> is admin-only — so if this sweep
 * ever reddens on a textarea, that is the reason, and the fix is the same pair.
 */
const FIELDS = "input, select, textarea";
const MIN_FONT = 16;

/**
 * Controls whose BOX is under the floor for a reason that is not about the
 * target. Every entry needs a reason of that kind, and a test that checks the
 * thing the box no longer proves.
 *
 * The skip link is `sr-only` until focused, which Playwright still counts as
 * visible because it has a box.
 *
 * The switch and the checkbox are 20px and 16px because that is what those
 * controls look like; both take the floor as a 44px `::before` instead, and
 * `getBoundingClientRect` does not include a pseudo-element. They are covered by
 * "gives the switch and the checkbox a thumb-sized target" below, which asks
 * `elementFromPoint` what is at the corner of that square — a stronger check
 * than the box measurement, because it tests the rule rather than a proxy for
 * it. An entry here without that second test is just an excuse.
 */
const EXEMPT: { name?: RegExp; role?: string; why: string }[] = [
  { name: /^skip to content$/i, why: "sr-only until focused" },
  { role: "switch", why: "20px track, 44px ::before hit area — see the elementFromPoint test" },
  { role: "checkbox", why: "16px box, 44px ::before hit area — same" },
];

/**
 * Text allowed to clip, each with the route it is on and the reason it is
 * allowed. Same contract as EXEMPT above.
 *
 * This list is now EMPTY, and the reason it is empty is worth more than the list
 * was.
 *
 * All three entries rested on one sentence — "§0 sets the console aside from the
 * phone type and touch rules by design" — and the third pass revoked exactly
 * that premise: it audited the console under the same rules as everything else.
 * An exemption whose justification has been withdrawn is not an exemption, so
 * the two console screens were fixed rather than re-excused.
 *
 * The third was never a console screen at all. `/awards` is a player-facing
 * ballot, and its entry said so: "nothing in §22 or §23 measures this screen".
 * That is an exemption resting on the audit's own coverage gap rather than on a
 * decision anyone made — the most expensive kind, because it reads like a
 * judgement and is actually a blind spot.
 *
 * Keep the shape. If a clip ever does earn an exemption, it is scoped to path
 * AND class so the sweep still gates everything else on that route, and so the
 * same class on a card screen is not quietly excused with it. What an entry
 * needs is a reason that stays true when the scope changes.
 */
const CLIP_EXEMPT: { path: string; hint: RegExp; why: string }[] = [];

/**
 * Every visible control that is too short, named well enough to find in the
 * source from the failure text alone.
 *
 * One evaluateAll rather than a boundingBox() per element: it is a single round
 * trip instead of forty, and every control is measured on the same frame, so a
 * re-render between two of them cannot skew the answer.
 */
async function shortTargets(page: Page): Promise<string[]> {
  const measured = await page
    .locator(CONTROLS)
    .filter({ visible: true })
    .evaluateAll((els) =>
      els.map((el) => ({
        height: el.getBoundingClientRect().height,
        tag: el.tagName.toLowerCase(),
        name: (el.getAttribute("aria-label") ?? el.textContent ?? "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 50),
        // The class fragment is what makes a failure actionable: this is a
        // class-driven floor, so it is the string you grep for.
        hint: (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean).slice(0, 3).join(" "),
        // Radix sets an implicit role on the two controls whose hit area is
        // larger than their box, and the role is the stable handle: their
        // accessible names come from whatever row they sit in.
        role: el.getAttribute("role") ?? "",
      })),
    );

  return measured
    .filter(
      (t) =>
        t.height < MIN_TARGET &&
        !EXEMPT.some((e) => (e.role ? e.role === t.role : e.name?.test(t.name))),
    )
    .map((t) => `${t.height.toFixed(0)}px <${t.tag}> "${t.name || "(unnamed)"}" — ${t.hint}`);
}

/** Every visible field small enough to zoom the page on focus. */
async function zoomingFields(page: Page): Promise<string[]> {
  const measured = await page
    .locator(FIELDS)
    .filter({ visible: true })
    .evaluateAll((els) =>
      els.map((el) => ({
        px: parseFloat(getComputedStyle(el).fontSize),
        tag: el.tagName.toLowerCase(),
        // A field's own name is rarely its text, so the label hooks come first.
        name: (
          el.getAttribute("aria-label") ??
          el.getAttribute("id") ??
          el.getAttribute("placeholder") ??
          ""
        ).slice(0, 50),
        hint: (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean).slice(0, 3).join(" "),
      })),
    );

  return measured
    .filter((f) => f.px < MIN_FONT)
    .map((f) => `${f.px}px <${f.tag}> "${f.name || "(unnamed)"}" — ${f.hint}`);
}

/**
 * The three phone widths the audit measures at.
 *
 * The mobile project is the iPhone 13 preset, so 390 is what every other sweep
 * in this file runs at. Clipping is the one failure that is a function of width
 * rather than of the pointer: a label that fits at 390 loses its tail at 320,
 * which is what §23 F7, F8 and their render set are.
 */
const CLIP_WIDTHS = [320, 390, 430];

/**
 * Text that is actually being cut off, as opposed to text that merely could be.
 *
 * `text-overflow: ellipsis` is the marker rather than `overflow: hidden`: it is
 * what `truncate` sets and what draws the "…" a phone has no hover to resolve.
 * `line-clamp` deliberately does not set it, which is why wrapping a name to two
 * lines reads here as a fix and not as a second failure — the tail of something
 * clamped is gone, but nothing promised the rest of it.
 *
 * `getClientRects()` rather than `offsetParent`, which is null for a `fixed`
 * element as well as for a hidden one — the trading post's own CTA is fixed.
 *
 * The 1px slack is rounding: scrollWidth and clientWidth are integers over a
 * layout that is not, so a subpixel-wide box reports one pixel of overflow it
 * does not have.
 */
const CLIP_SLACK = 1;

/**
 * Every route in the table is swept; the three screens the audit puts outside
 * its scope answer for what they carry through CLIP_EXEMPT rather than by being
 * skipped, so a new clip on one of them still fails.
 */
async function clippedText(page: Page, width: number, path: string): Promise<string[]> {
  const measured = await page.evaluate(
    (slack) =>
      Array.from(document.querySelectorAll<HTMLElement>("*"))
        .filter(
          (el) =>
            getComputedStyle(el).textOverflow === "ellipsis" &&
            el.scrollWidth - el.clientWidth > slack &&
            el.getClientRects().length > 0,
        )
        .map((el) => ({
          over: el.scrollWidth - el.clientWidth,
          tag: el.tagName.toLowerCase(),
          text: (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40),
          hint: (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean).slice(0, 3).join(" "),
        })),
    CLIP_SLACK,
  );

  return measured
    .filter((c) => !CLIP_EXEMPT.some((e) => e.path === path && e.hint.test(c.hint)))
    .map((c) => `${width}px: <${c.tag}> "${c.text}" over by ${c.over}px — ${c.hint}`);
}

/**
 * §16's two type rules, and the first gate either of them has ever had.
 *
 * §28's ledger credits PR 1 with "the 11px floor and the 0.08em tracking cap,
 * and the tap-target sweep in e2e/smoke.spec.ts that keeps them" — but the
 * sweep PR 1 left keeps the tap targets. MIN_FONT above measures fields, for
 * iOS zoom, and nothing in this repo has ever measured a text node's size or
 * its tracking. Three passes found type violations by counting them off a
 * render set by hand, which is how the ballot's 9.6px initials survived all
 * three of them.
 *
 * The cap is an em, and the awkward part is that letter-spacing inherits as a
 * computed *length*: 0.08em on a 13px parent is 1.04px, and that same 1.04px
 * on a 12px child reads back as 0.087em — over the cap, on an element carrying
 * no tracking class at all. §0 records that false positive against the trade
 * tab's unread badge.
 *
 * The first version of this sweep dodged it with a flat 1.12px ceiling, which
 * is 0.08em at 14px. That let the badge through, and an 11px label through with
 * it: 0.1em there is 1.10px, under the ceiling and over the cap, so the sweep
 * could not see tracking-widest coming back on the smallest labels in the app —
 * one of the two regressions it exists to catch. A cap calibrated at the top of
 * a range is loosest at the bottom of it.
 *
 * So the cap is proportional again, and the inheritance is handled where it
 * actually lives: an element whose computed letter-spacing equals its parent's
 * did not set it, and is not the element to blame for it. The parent is
 * measured on its own terms and answers there. No epsilon — px * 0.08 is exact
 * at every size in the scale (11 → 0.88, 12 → 0.96, 12.8 → 1.024, 13 → 1.04)
 * and the comparison is strict, so a value sitting exactly on the cap passes.
 *
 * /tv is in no sweep here, for the reason it is in none of the others — a board
 * read from across a garden, where the tracking is doing legibility work at
 * distance (§18). The wordmark and the claim screen's typed code are not
 * exceptions to the cap but outside it: both are set above 14px.
 */
const MIN_TEXT = 11;
const TRACKED_BELOW = 14;
const MAX_TRACKING_EM = 0.08;

/**
 * Every visible element that owns its text, measured where it is drawn.
 *
 * "Owns" is a direct child text node. An ancestor's textContent includes its
 * descendants', so a wrapper would be blamed for a size it does not set and the
 * same string would report once per level of nesting it happens to sit under.
 *
 * getClientRects() for the reason clippedText gives — offsetParent is null for
 * a fixed element as well as a hidden one — and it drops a collapsed
 * AdminSection with it, which is display:none rather than unmounted.
 */
async function offScaleText(page: Page, width: number): Promise<string[]> {
  const measured = await page.evaluate(
    ([floor, below, maxEm]) =>
      Array.from(document.querySelectorAll<HTMLElement>("*"))
        .filter(
          (el) =>
            Array.from(el.childNodes).some(
              (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== "",
            ) && el.getClientRects().length > 0,
        )
        .map((el) => {
          const cs = getComputedStyle(el);
          const px = parseFloat(cs.fontSize);
          // "normal" is the one value letter-spacing computes to that is not a
          // length, and it is the overwhelming majority of them.
          const track = cs.letterSpacing === "normal" ? 0 : parseFloat(cs.letterSpacing);
          // Same computed length as the parent means the parent set it. <html>
          // has no parentElement, so it always answers for its own.
          const parent = el.parentElement;
          const owned = !parent || getComputedStyle(parent).letterSpacing !== cs.letterSpacing;
          return {
            px,
            track,
            small: px < floor,
            loose: px < below && owned && track > px * maxEm,
            tag: el.tagName.toLowerCase(),
            text: (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40),
            hint: (el.getAttribute("class") ?? "")
              .split(/\s+/)
              .filter(Boolean)
              .slice(0, 3)
              .join(" "),
          };
        })
        .filter((m) => m.small || m.loose),
    [MIN_TEXT, TRACKED_BELOW, MAX_TRACKING_EM] as const,
  );

  return measured.map((m) => {
    const why = [
      m.small ? `${m.px}px, under the ${MIN_TEXT}px floor` : null,
      m.loose
        ? `tracked ${m.track}px at ${m.px}px — ` +
          `${(m.track / m.px).toFixed(3)}em, over the ${MAX_TRACKING_EM}em cap`
        : null,
    ]
      .filter(Boolean)
      .join("; ");
    return `${width}px: <${m.tag}> "${m.text}" — ${why} — ${m.hint}`;
  });
}

/** A member token these stubs never verify — the server is mocked out. */
async function signInAsMember(page: Page) {
  const me = PLAYERS[0];
  await page.addInitScript(
    ([key, token, who]) => {
      localStorage.setItem(key, token);
      localStorage.setItem("wwbh:member-name", who);
    },
    ["wwbh:member-token", `m.${me.pid}.${Date.now() + 60 * 60_000}.signature`, me.name] as const,
  );
}

/**
 * `settle` is the wait AND the route's own sanity check: measuring a screen that
 * has not filled in yet passes for the wrong reason, because half the controls
 * are not mounted yet.
 *
 * Every phone-facing route is here, and that breadth is the point: the floor was
 * guarded on three screens while the rest drifted, and a rule enforced in three
 * places is a rule the fourth screen does not have. /tv is the only deliberate
 * omission — it is a board read from across a garden and nothing on it is
 * tapped — and /admin is unreachable behind its PIN.
 */
const TAP_TARGET_ROUTES: {
  path: string;
  member?: true;
  arrange?: (server: ServerFnMock) => void;
  settle: (page: Page) => Promise<void>;
}[] = [
  {
    path: "/players",
    // The sort control lives on the roster shelf's header, so it only exists
    // once the sections have been built — which needs the bundle. Shuffle used
    // to be the wait here; it is inside the sheet now and not on the page at
    // all until the sheet is opened.
    settle: async (page) => {
      await expect(page.getByRole("button", { name: /sort and filter/i })).toBeVisible();
    },
  },
  {
    path: "/players/pack",
    // Not in ROUTES above and not warmed by global-setup, so this is the one
    // screen here the smoke suite does not otherwise open. Measured sealed: the
    // ceremony's own controls are covered by the component specs.
    settle: async (page) => {
      await expect(page.getByTestId("collected-count")).not.toHaveText(/—/);
      await expect(sealedPack(page)).toBeVisible();
    },
  },
  {
    path: "/players/trade",
    member: true,
    // Anonymous, this route redirects to /claim — which is what the ROUTES entry
    // above covers. The heading proves the member branch rendered, so a broken
    // session fails here rather than silently measuring /claim.
    settle: async (page) => {
      await expect(page.getByRole("heading", { name: "Trading Post" })).toBeVisible();
    },
  },
  {
    // A card page, where the chips under the card are the densest row of
    // controls in the app.
    path: `/players/${PLAYERS[0].ep}`,
    settle: async (page) => {
      await expect(page.getByRole("heading", { name: PLAYERS[0].name })).toBeVisible();
    },
  },
  {
    // With dust ON, or the whole screen is the switched-off notice and none of
    // the controls this is here to measure exist.
    path: "/players/shop",
    member: true,
    arrange: (server) => {
      server.set("getActiveEvent", { ...BUNDLE.event, dust_enabled: true });
      // A claimed member with dust to spend, so the shelf renders Buy buttons
      // rather than the "nothing you can afford" branch.
      server.set("getDustBalance", { balance: 500 });
    },
    settle: async (page) => {
      await expect(page.getByRole("heading", { name: /^dust$/i })).toBeVisible();
      // The heading is in both branches, so on its own it would have let this
      // measure the switched-off notice and pass for the wrong reason. The
      // sentence below only exists while dust is off. (The switch is read off
      // getActiveEvent — useEventBundle takes its event from there, see
      // use-event-bundle.ts:15 — which is why the arrange sets that one.)
      await expect(page.getByText(/has not switched dust on/i)).toHaveCount(0);
    },
  },
  {
    // With dust on and a claimed member, which is the only state in which every
    // section of this screen exists — the dust chip is gated on both.
    path: "/you",
    member: true,
    arrange: (server) => {
      server.set("getActiveEvent", { ...BUNDLE.event, dust_enabled: true });
      server.set("getDustBalance", { balance: 140 });
    },
    settle: async (page) => {
      await expect(page.getByRole("heading", { name: /^you$/i })).toBeVisible();
      // The three device settings are the rows this screen exists for, and they
      // are the last thing to mount.
      await expect(page.getByRole("button", { name: /^tilt/i })).toBeVisible();
    },
  },
  {
    path: "/leaderboard",
    settle: async (page) => {
      await expect(page.getByRole("main")).toContainText(PLAYERS[0].name);
    },
  },
  {
    path: "/league",
    settle: async (page) => {
      await expect(page.getByRole("heading", { name: "The League" })).toBeVisible();
    },
  },
  {
    path: "/awards",
    settle: async (page) => {
      await expect(page.getByRole("heading", { name: "League Awards" })).toBeVisible();
    },
  },
  {
    // A marshal's screen, held in one hand at a start line — the place a 32px
    // button costs a run rather than a tap.
    path: "/live",
    settle: async (page) => {
      await expect(page.getByRole("main")).toContainText(/spectator/i);
    },
  },
  {
    path: "/analytics",
    // With an archive in it: the rows are links, and a list nobody stubs renders
    // as "no archived events yet" with nothing to measure.
    arrange: (server) =>
      server.set("listArchives", [
        {
          id: "arch-1",
          slug: "combine-2025",
          event_name: "Draft Combine",
          event_year: 2025,
          created_at: "2025-08-24T12:00:00.000Z",
        },
      ]),
    settle: async (page) => {
      await expect(page.getByRole("heading", { name: /splits & records/i })).toBeVisible();
    },
  },
  {
    path: "/claim",
    settle: async (page) => {
      await expect(page.getByRole("heading", { name: /claim your player/i })).toBeVisible();
    },
  },
  {
    path: "/auth",
    settle: async (page) => {
      await expect(page.getByRole("heading", { name: /^sign in$/i })).toBeVisible();
    },
  },
  {
    // The draft board. A grid of position tiles and a row of player links, and
    // the links were 36px — the only control under the floor anywhere in the app
    // when the third pass measured, on a route nothing had ever measured.
    path: "/draft",
    settle: async (page) => {
      await expect(page.getByRole("main")).toContainText(/on the clock/i);
    },
  },
  {
    // The running order a marshal reads at a start line. Every name on it clips
    // at 320; two of them by more than 16px. PR 13 made this exact argument
    // about the leaderboard and fixed it there.
    path: "/order",
    settle: async (page) => {
      await expect(page.getByRole("heading", { name: /running order/i })).toBeVisible();
    },
  },
];

// Three rules over one page load each: nothing a thumb can land on under 44px,
// no field iOS Safari would zoom the page to reach, and no label losing its tail
// to an ellipsis at any of the three phone widths.
test.describe("phone sweeps", () => {
  for (const route of TAP_TARGET_ROUTES) {
    test(`${route.path} holds the thumb, keyboard and width floors`, async ({
      page,
      server,
    }, testInfo) => {
      test.skip(
        testInfo.project.name !== "mobile",
        "44px is a touch rule; the desktop chrome is mouse-driven and 24px is its bar.",
      );
      route.arrange?.(server);
      if (route.member) await signInAsMember(page);

      await page.goto(route.path);
      await route.settle(page);

      // One assertion over the whole list rather than one per element: a bare
      // toBeGreaterThanOrEqual inside a loop reports "36 is not >= 44" and
      // nothing about which of forty controls it was.
      expect(
        await shortTargets(page),
        `Controls under ${MIN_TARGET}px on ${route.path}. Grow the hit box ` +
          `(min-h-11, or h-11 w-11 with the glyph centred) — not the glyph.`,
      ).toEqual([]);

      expect(
        await zoomingFields(page),
        `Fields under ${MIN_FONT}px on ${route.path}, which iOS Safari zooms ` +
          `the page to reach. Use text-base with a pointer-fine:text-sm release.`,
      ).toEqual([]);

      // Resized rather than reloaded: clipping is a layout answer and the page
      // has already settled, so a second and third round trip would buy nothing
      // but the flake of settling twice more.
      const clipped: string[] = [];
      const offScale: string[] = [];
      for (const width of CLIP_WIDTHS) {
        await page.setViewportSize({ width, height: page.viewportSize()?.height ?? 844 });
        clipped.push(...(await clippedText(page, width, route.path)));
        offScale.push(...(await offScaleText(page, width)));
      }
      expect(
        clipped,
        `Text clipped by an ellipsis on ${route.path}. On a phone there is no ` +
          `hover to resolve one, so wrap it (line-clamp-2) or give it the room.`,
      ).toEqual([]);

      expect(
        offScale,
        `Type off §16's scale on ${route.path}. The floor is ${MIN_TEXT}px, and ` +
          `the cap ${MAX_TRACKING_EM}em on anything under ${TRACKED_BELOW}px. ` +
          `Name the size (text-label, text-meta) rather than setting it.`,
      ).toEqual([]);
    });
  }

  /**
   * Two controls whose hit area is bigger than their box, proved the way the
   * rule actually reads.
   *
   * A switch is 20px tall and a checkbox 16px, because that is what those
   * controls look like — growing either to 44 draws something else. So both take
   * the floor as a 44px `::before` instead, and `getBoundingClientRect` cannot
   * see a pseudo-element: the sweep above reports them at 20 and 16 however big
   * the thumb's target really is.
   *
   * Exempting them would be the easy answer and the wrong one — this pass spent
   * its time deleting exemptions that had outlived their reason. The rule is
   * "a thumb can land on it", so test that: ask the document what is at the
   * corner of the 44px square and require it to be the control.
   */
  test("gives the switch and the checkbox a thumb-sized target", async ({
    page,
    server,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "44px is a touch rule; see the sweep above");
    server.set("getActiveEvent", { ...BUNDLE.event, dust_enabled: true });
    // The console mounts every panel at once — AdminSection uses forceMount, so
    // a collapsed one is display:none rather than absent — which means every
    // panel's query fires on load. None of these five is in DEFAULT_RESPONSES,
    // because until this pass nothing in the browser suite had ever opened
    // /admin. The shapes are empty on purpose: this test is about a hit area,
    // not about what the panels say.
    server.set("listCardPromptTemplates", { templates: [] });
    server.set("listCardPromptRuns", { runs: [] });
    server.set("listMemberClaims", []);
    server.set("getAwardTally", { tally: {}, totalVotes: 0 });
    server.set("getOwnershipAudit", { players: [], stranded: [] });

    // The client only checks the SHAPE of this token — three dot-parts and a
    // future expiry, src/lib/admin-token.ts:8-16 — but admin.tsx compares its
    // first part against the event id, so a fresh uuid here would leave the
    // console showing PinGate and this test measuring the wrong screen.
    await page.addInitScript(([key, token]) => localStorage.setItem(key, token), [
      "wwbh:admin-token",
      `${EVENT_ID}.${Date.now() + 12 * 3600_000}.e2e-signature`,
    ] as const);
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: /timing console/i })).toBeVisible();

    /**
     * Presses each corner of the 44px square and requires the control to answer.
     *
     * A tap, not `elementFromPoint`. The first version of this asked the
     * document what element sat at the corner and required it to be the control
     * — which passed for the switch and failed for the checkbox, for a reason
     * that has nothing to do with either hit area: the switch is rendered AFTER
     * its label so its `::before` paints on top, and the checkbox BEFORE its
     * label text, which paints over it. Both are reachable by a thumb in exactly
     * the same way. The identity of the topmost element was never the rule.
     *
     * Four corners in turn, each press required to flip the state, so the whole
     * square is proved rather than one lucky point.
     */
    const cornersRespond = async (control: Locator, label: string) => {
      await expect(control).toBeVisible();
      // Centred first, and this is not a nicety. `page.mouse.click` takes
      // viewport coordinates and does not scroll, unlike `locator.click()` —
      // and the phone's tab bar is `fixed` over the bottom 71px. The batch
      // checkbox sits at y=801 in an 844px viewport on first render, so every
      // press landed on the nav and the control looked like four dead corners
      // while being perfectly fine.
      await control.evaluate((el) => el.scrollIntoView({ block: "center" }));
      const box = await control.boundingBox();
      if (!box) throw new Error(`${label}: no box to measure`);
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      // Just inside each corner of the 44px square the ::before draws.
      const reach = 21;
      const dead: string[] = [];
      for (const [dx, dy] of [
        [-reach, -reach],
        [reach, -reach],
        [-reach, reach],
        [reach, reach],
      ]) {
        const was = await control.getAttribute("data-state");
        await page.mouse.click(cx + dx, cy + dy);
        const now = await control.getAttribute("data-state");
        if (now === was) dead.push(`(${dx}, ${dy}) did nothing`);
      }
      return dead;
    };

    // The nav-rows panel is the app's only Switch, one per row. Toggling is
    // local draft state until Save, so pressing it four times writes nothing.
    //
    // NOT `.first()`, which is the Vault row: it is pinned, so its switch is
    // disabled, and a disabled control correctly does nothing when pressed. That
    // reads back as four dead corners on a control that is behaving perfectly.
    await page
      .getByRole("button", { name: /^Navigation/i })
      .first()
      .click();
    expect(
      await cornersRespond(page.locator('[role="switch"]:not([disabled])').first(), "switch"),
      "Part of the switch's 44px square is a dead zone. The ::before in " +
        "ui/switch.tsx is what provides it; check `relative` is still on the root.",
    ).toEqual([]);

    // And the app's only Checkbox, two disclosures deep: the Card Prompt Studio
    // panel, then Batch Production inside it. Reaching it is the point — EXEMPT
    // exempts every role="checkbox" in the app, so without this a regression in
    // ui/checkbox.tsx would pass the whole suite. Selecting players only arms a
    // Build Batch button that nothing here presses.
    //
    // Measured, for whoever changes this next: the target here is the 280x44
    // `<label>` around it, which forwards its click to the Radix button. The
    // `::before` in ui/checkbox.tsx is belt to that braces — it is what a
    // checkbox with no label would fall back on, and it is overlapped by the
    // label's own text wherever there IS one.
    await page
      .getByRole("button", { name: /^Card Prompt Studio/i })
      .first()
      .click();
    await page.getByText("Batch Production", { exact: true }).click();
    expect(
      await cornersRespond(page.locator('[role="checkbox"]:not([disabled])').first(), "checkbox"),
      "Part of the checkbox's 44px square is a dead zone. Either the ::before in " +
        "ui/checkbox.tsx or the min-h-11 label around it should be answering.",
    ).toEqual([]);
  });

  /**
   * The one control the sweep above structurally cannot reach.
   *
   * A closed menu has no items in the DOM, so `shortTargets` walks straight past
   * `DropdownMenuItem` no matter how many routes it visits — which is how a 32px
   * row survived three passes on a menu that is player-facing. It is the "more
   * actions" overflow on the card page and in the viewer, and it is where Share,
   * Compare and the card settings live on a phone.
   *
   * Opened here rather than measured in place, because there is no other way:
   * the rule is not "these routes are clean", it is "nothing under 44px", and a
   * sweep that only sees what happens to be mounted cannot say that.
   */
  test("holds the floor inside the card page's overflow menu", async ({
    page,
    server,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "44px is a touch rule; see the sweep above");
    void server;
    await signInAsMember(page);
    await page.goto(`/players/${PLAYERS[0].ep}`);
    await expect(page.getByRole("heading", { name: PLAYERS[0].name })).toBeVisible();

    await page.getByRole("button", { name: "More actions" }).first().click();
    // `menuitemcheckbox`, not `menuitem`: this particular menu is Tilt and
    // Sound, which are CheckboxItems. Waiting on the wrong role passes the click
    // and then times out on a menu that is already open — and the reason this
    // test exists is that the floor was on `DropdownMenuItem` alone, which is
    // not what this menu is made of.
    await expect(page.getByRole("menu", { name: "More actions" })).toBeVisible();
    await expect(page.getByRole("menuitemcheckbox").first()).toBeVisible();

    expect(
      await shortTargets(page),
      "Controls under 44px with the overflow menu open. The floor belongs to " +
        "ui/dropdown-menu.tsx, not to the call site.",
    ).toEqual([]);
  });

  // The sweep above runs the routes as the tap-target table arranges them, and
  // two of §23 F8's three sites need more than that: a secret shelf only exists
  // once you hold a secret, and the slab plate only squeezes its event line once
  // there is a collection mark beside it. Both were measured with a full member
  // in the audit's render set, so both are arranged here rather than left to a
  // sweep that cannot see them.
  test("does not clip a secret's caption on the shelf", async ({ page, server }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "a width finding, measured on the phone project");
    await signInAsMember(page);
    server.set("getSecretCollections", {
      collections: [{ id: "pets", label: "Pets", accent: "mint" }],
    });
    server.set("getMySecrets", {
      pulled: 1,
      cards: [
        {
          ...SECRET_CARD,
          collection: "pets",
          firstPulledOn: "2026-07-28",
          count: 1,
          ownerCount: 3,
        },
      ],
    });

    await page.goto("/players");
    // "Common · 70%" — the widest of the five, and the one the audit measured
    // 23px over at 320. Matched on the whole caption rather than the number
    // alone, so this still fails if the tier word beside it goes missing: the
    // finding is about the width of the LINE.
    await expect(page.getByText(/common · 70%/i).first()).toBeVisible();

    await page.setViewportSize({ width: 320, height: 568 });
    expect(await clippedText(page, 320, "/players")).toEqual([]);
  });

  test("does not clip the event's own name on the slab plate", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "a width finding, measured on the phone project");
    // A pack rather than a stub: the collection is IndexedDB on the device, and
    // opening one is how a device comes to have a mark on the plate at all.
    await page.goto("/players/pack");
    await tearPack(page);
    await page.getByRole("button", { name: /reveal all/i }).click();
    await expect(page.getByText(/pack complete/i)).toBeVisible({ timeout: 30_000 });

    await page.goto(`/players/${PLAYERS[0].ep}`);
    // .first(): the share graphic offscreen carries the same line.
    await expect(page.getByText("Draft Combine 2026").first()).toBeVisible();

    await page.setViewportSize({ width: 320, height: 568 });
    expect(await clippedText(page, 320, `/players/${PLAYERS[0].ep}`)).toEqual([]);
  });

  test("holds the floor on a phone turned sideways", async ({ page, server }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "a coarse pointer is the whole point of this");
    void server;

    // The case a width-based rule gets wrong, and the reason the floor is keyed
    // on `pointer: coarse` rather than on `sm:`. A landscape phone is past the
    // 640px breakpoint while the thumb is still the input, so a `sm:` step down
    // would hand back every control this suite measures — and the portrait run
    // above would not see it go.
    await page.setViewportSize({ width: 844, height: 390 });
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);

    await page.goto("/players");
    await expect(page.getByRole("button", { name: /sort and filter/i })).toBeVisible();

    expect(
      await shortTargets(page),
      `Controls under ${MIN_TARGET}px on /players in landscape. The floor is a ` +
        `pointer rule, not a width one — check for a stray sm: step.`,
    ).toEqual([]);
  });

  /**
   * The same argument one breakpoint further out, for the fields (§23 F2).
   *
   * 844px is past `md:` as well as `sm:`, so a `md:text-sm` — which is what
   * ui/input.tsx said until this suite could see it — reports 16px in the
   * portrait run above and 14px here, on the same phone, in the same hand.
   *
   * The routes are the three that actually have a field on them, and they are
   * taken from the table above rather than re-listed, so they keep their real
   * settle: a screen measured before it has filled in has no fields on it yet
   * and passes for the wrong reason.
   */
  const LANDSCAPE_FIELD_ROUTES = ["/claim", "/auth", `/players/${PLAYERS[0].ep}`].map((path) => {
    const route = TAP_TARGET_ROUTES.find((r) => r.path === path);
    if (!route) throw new Error(`${path} left TAP_TARGET_ROUTES; this run needs its settle`);
    return route;
  });

  for (const route of LANDSCAPE_FIELD_ROUTES) {
    test(`keeps ${route.path}'s fields off the zoom threshold sideways`, async ({
      page,
      server,
    }, testInfo) => {
      test.skip(testInfo.project.name !== "mobile", "a coarse pointer is the whole point of this");
      route.arrange?.(server);

      await page.setViewportSize({ width: 844, height: 390 });
      expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);

      await page.goto(route.path);
      await route.settle(page);

      expect(
        await zoomingFields(page),
        `Fields under ${MIN_FONT}px on ${route.path} at 844px. A landscape phone ` +
          `is past md: with the thumb still the input — the release is pointer-fine:.`,
      ).toEqual([]);
      expect(await shortTargets(page)).toEqual([]);
    });
  }

  /**
   * The guest-name prompt, which is the one field F2 singles out: it carries
   * `autoFocus`, so a 14px version zooms the page as it appears rather than
   * waiting to be tapped.
   *
   * Sideways for the same reason as the runs above — that is where a width
   * breakpoint hands the 14px back, and this is the field least able to afford
   * it. It only exists after a guest tries to post, and `ensureIdentity` opens
   * it and returns before any server call, so the interaction costs nothing.
   */
  test("holds the floor on the prompt that focuses itself", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "a coarse pointer is the whole point of this");

    await page.setViewportSize({ width: 844, height: 390 });
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);

    await page.goto(`/players/${PLAYERS[0].ep}`);
    await expect(page.getByRole("heading", { name: PLAYERS[0].name })).toBeVisible();

    await page.getByPlaceholder(/talk your talk/i).fill("first");
    await page.getByRole("button", { name: "Post" }).click();

    // Also the only assertion here that proves `autoFocus` survives hydration.
    await expect(page.getByPlaceholder("Your name")).toBeFocused();
    expect(await zoomingFields(page)).toEqual([]);
    expect(await shortTargets(page)).toEqual([]);
  });
});

/**
 * A caller that states its own size keeps it on both pointers.
 *
 * `Input` releases to `pointer-fine:text-sm`, and a variant-prefixed utility
 * outranks an unprefixed one however the two merge — so a bare `text-2xl` on
 * the member code box rendered 24px on a phone and 14px on a laptop, on the one
 * field whose whole job is to be read a character at a time at 0.4em tracking.
 *
 * Deliberately NOT skipped on desktop: the fine pointer is the half that broke,
 * and it is the only thing in this file a mouse is the right instrument for.
 */
test.describe("field sizing", () => {
  test("gives the member code the size it asks for on either pointer", async ({ page }) => {
    await page.goto("/claim");
    await expect(page.getByRole("heading", { name: /claim your player/i })).toBeVisible();

    expect(
      await page.locator("#member-code").evaluate((el) => getComputedStyle(el).fontSize),
      "the code box lost its size to the primitive's pointer-fine: release — a " +
        "caller that sets text-* has to set the pointer-fine: one too.",
    ).toBe("24px");
  });
});
