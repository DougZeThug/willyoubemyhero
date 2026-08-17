// Every public route renders, hydrates, and survives having no data.
import { test, expect } from "./fixtures";

const ROUTES = [
  { path: "/", title: /Draft Combine|Hero/i },
  { path: "/live", title: /Live/i },
  { path: "/leaderboard", title: /Leaderboard/i },
  { path: "/players", title: /Vault|Players/i },
  { path: "/players/trade", title: /Trading Post/i },
  { path: "/awards", title: /Awards/i },
  { path: "/claim", title: /Claim/i },
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
});
