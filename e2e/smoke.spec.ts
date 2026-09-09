// Every public route renders, hydrates, and survives having no data.
import type { Page } from "@playwright/test";
import { test, expect, BUNDLE, PLAYERS, sealedPack, type ServerFnMock } from "./fixtures";

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
];

test.describe("tap targets", () => {
  for (const route of TAP_TARGET_ROUTES) {
    test(`${route.path} has nothing smaller than a thumb`, async ({ page, server }, testInfo) => {
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
    });
  }

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
