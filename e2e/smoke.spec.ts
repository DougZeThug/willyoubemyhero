// Every public route renders, hydrates, and survives having no data.
import type { Page } from "@playwright/test";
import { test, expect, PLAYERS, sealedPack } from "./fixtures";

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
  // These three render the same data the rest do and were simply missed.
  { path: "/analytics", title: /Analytics/i },
  { path: "/tv", title: /TV|Board|Combine/i },
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

  test("puts a skip link ahead of the whole nav", async ({ page, server }) => {
    void server;
    await page.goto("/leaderboard");
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
        ],
        runs: [
          { id: "r-1", participant_id: "p-1", is_official: true, official_time_ms: 61_000 },
          // Official with no time yet: it belongs LAST, which is the thing three
          // screens used to get backwards.
          { id: "r-2", participant_id: "p-2", is_official: true, official_time_ms: null },
        ],
        drafts: [{ selection_order: 1, participant_id: "p-1", draft_position: 1 }],
      },
    });

    await page.goto("/analytics");
    await page.getByRole("link", { name: /Draft Combine 2025/ }).click();
    await expect(page).toHaveURL(/\/recap\/combine-2025$/);
    await expect(page.getByText("1:01.00")).toBeVisible();

    const names = await page.getByText(/^(Doug|Alice)$/).allTextContents();
    expect(names[0]).toBe("Doug");
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

/** Everything a thumb can land on. An <a> with no href is not one. */
const CONTROLS = 'button, a[href], [role="button"]';

/**
 * Controls allowed under the floor, each with the reason it is allowed.
 *
 * The skip link is the only one: it is `sr-only` until focused, which Playwright
 * still counts as visible because it has a box. Anything added here needs a
 * reason of the same kind beside it.
 */
const EXEMPT = [{ name: /^skip to content$/i, why: "sr-only until focused" }];

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
      })),
    );

  return measured
    .filter((t) => t.height < MIN_TARGET && !EXEMPT.some((e) => e.name.test(t.name)))
    .map((t) => `${t.height.toFixed(0)}px <${t.tag}> "${t.name || "(unnamed)"}" — ${t.hint}`);
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
 */
const TAP_TARGET_ROUTES: {
  path: string;
  member?: true;
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
];

test.describe("tap targets", () => {
  for (const route of TAP_TARGET_ROUTES) {
    test(`${route.path} has nothing smaller than a thumb`, async ({ page, server }, testInfo) => {
      test.skip(
        testInfo.project.name !== "mobile",
        "44px is a touch rule; the desktop chrome is mouse-driven and 24px is its bar.",
      );
      void server;
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
    });
  }
});
