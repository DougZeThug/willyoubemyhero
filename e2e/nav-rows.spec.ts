// The bottom bar, and the rows the commissioner has taken off it.
//
// The bar is the whole of this app's navigation on a phone, so both directions
// are worth pinning: a bar still carrying a row that was switched off is a tab
// nobody meant to ship, and a bar missing one that was not is a screen nobody can
// reach. What is deliberately NOT tested here is a route being gated, because it
// is not one — see the last test.
import { test, expect, BUNDLE } from "./fixtures";

/** The active event with rows taken off the bar. */
function withNav(hidden: string[], dust = false) {
  return { ...BUNDLE.event, dust_enabled: dust, nav_hidden: hidden };
}

test.describe("the bottom bar", () => {
  test("carries every row while the commissioner has hidden none", async ({ page, server }) => {
    // The default fixture event has no nav_hidden at all, which is the state
    // every other spec in this suite runs in — and the reason none of them had
    // to change for this feature.
    void server;
    await page.goto("/players");
    await expect(page.getByRole("navigation").getByRole("link")).toHaveCount(5);
  });

  test("contracts to fit what is left", async ({ page, server }) => {
    server.set("getActiveEvent", withNav(["trade", "league"]));
    await page.goto("/players");
    const nav = page.getByRole("navigation");
    await expect(nav.getByRole("link")).toHaveCount(3);
    await expect(nav.getByRole("link", { name: /^trade$/i })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: /^league$/i })).toHaveCount(0);
  });

  test("keeps the vault whatever the column says", async ({ page, server }) => {
    // The pin from the far end: a row that should never have been stored still
    // cannot take the vault off, because the vault is the way back to the cards.
    server.set("getActiveEvent", withNav(["vault", "pack", "trade", "board", "league"]));
    await page.goto("/players");
    const nav = page.getByRole("navigation");
    await expect(nav.getByRole("link")).toHaveCount(1);
    await expect(nav.getByRole("link", { name: /^vault$/i })).toBeVisible();
  });

  test("keeps the shop answering to dust and not to this switch", async ({ page, server }) => {
    // Two switches that can disagree is a Shop tab leading to "the commissioner
    // has not switched dust on yet".
    server.set("getActiveEvent", withNav(["shop"], true));
    const nav = page.getByRole("navigation");
    await page.goto("/players");
    await expect(nav.getByRole("link", { name: /^shop$/i })).toBeVisible();
    await expect(nav.getByRole("link")).toHaveCount(6);
  });

  test("divides the bar evenly however many rows are on it", async ({ page, server }, info) => {
    // The one assertion here about the layout rather than the list, and the
    // reason the bar is flex-1 tiles rather than a grid-cols-N class: a computed
    // class emits no CSS, and a lookup map silently stacks the whole bar in one
    // column the day somebody adds a row it does not list.
    test.skip(info.project.name !== "mobile", "the bottom bar is the phone's bar");
    server.set("getActiveEvent", withNav(["league"]));
    await page.goto("/players");
    const tiles = page.locator('nav[aria-label="Primary"] a');
    await expect(tiles).toHaveCount(4);
    const widths = await tiles.evaluateAll((els) =>
      els.map((e) => Math.round(e.getBoundingClientRect().width)),
    );
    expect(new Set(widths).size).toBe(1);
  });

  test("still answers on a screen whose row is switched off", async ({ page, server }) => {
    // Hiding a row is not a route gate — the fourth time this app has written
    // that down. A link in the trade feed, a bookmark and the spectator QR code
    // all outlive a switch, so the page renders. It simply has no tab lit, which
    // is the honest answer rather than lighting a near miss.
    server.set("getActiveEvent", withNav(["board"]));
    await page.goto("/leaderboard");
    await expect(page.getByRole("main")).not.toBeEmpty();
    await expect(page.locator('[aria-current="page"]:visible')).toHaveCount(0);
  });
});
