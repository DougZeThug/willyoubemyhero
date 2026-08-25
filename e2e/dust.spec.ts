// The dust economy's own screen, and the tab that comes and goes with it.
//
// The tab is the only part of this app's chrome that is conditional, so the two
// states are worth pinning in both directions: a bar that keeps a Shop tab after
// the commissioner switches dust off is a tab leading to "not yet", and a bar
// that never grows one is a screen nobody can reach.
import { test, expect, BUNDLE } from "./fixtures";
import type { Page } from "@playwright/test";

const MEMBER_KEY = "wwbh:member-token";

/** dust_ledger is keyed on a participant, so the chip needs a claimed one. */
async function asMember(page: Page) {
  await page.addInitScript(([key, token]) => localStorage.setItem(key, token), [
    MEMBER_KEY,
    `m.p-alice.${Date.now() + 60 * 60_000}.signature`,
  ] as const);
}

/** The active event with the commissioner's dust switch thrown. */
function withDust(on: boolean) {
  return { ...BUNDLE.event, dust_enabled: on };
}

test.describe("the dust shop", () => {
  test("has no tab while the commissioner has dust switched off", async ({ page, server }) => {
    // The default fixture event carries no dust_enabled at all, which is the
    // state every other spec in this suite runs in.
    void server;
    await page.goto("/players");
    const nav = page.getByRole("navigation");
    await expect(nav.getByRole("link", { name: /^shop$/i })).toHaveCount(0);
    await expect(nav.getByRole("link")).toHaveCount(5);
  });

  test("grows a tab that reaches the shop once dust is on", async ({ page, server }) => {
    server.set("getActiveEvent", withDust(true));
    await page.goto("/players");
    const nav = page.getByRole("navigation");
    await expect(nav.getByRole("link")).toHaveCount(6);

    await nav.getByRole("link", { name: /^shop$/i }).click();
    await expect(page).toHaveURL(/\/players\/shop$/);
    await expect(page.getByRole("heading", { name: /^dust$/i })).toBeVisible();
  });

  test("the vault's dust chip goes to the same screen", async ({ page, server }) => {
    // The chip renders nothing until a balance is known, and a balance needs a
    // claimed member — so this needs both halves, not just the switch.
    await asMember(page);
    server.set("getActiveEvent", withDust(true));
    server.set("getDustBalance", { balance: 140 });
    await page.goto("/players");

    const chip = page.getByRole("main").getByRole("link", { name: /140 dust/i });
    await expect(chip).toBeVisible();
    await chip.click();
    await expect(page).toHaveURL(/\/players\/shop$/);
  });

  test("still answers on a bookmarked URL after dust is switched off", async ({ page, server }) => {
    // The tab disappears but the link somebody saved does not, and a 404 on a
    // screen that worked yesterday reads as a broken app rather than a switch.
    void server;
    await page.goto("/players/shop");
    await expect(page.getByRole("heading", { name: /^dust$/i })).toBeVisible();
    await expect(page.getByText(/has not switched dust on/i)).toBeVisible();
  });

  test("asks an unclaimed visitor for a name before it offers to sell anything", async ({
    page,
    server,
  }) => {
    // dust_ledger is keyed on a participant, so a guest has nothing to spend.
    server.set("getActiveEvent", withDust(true));
    await page.goto("/players/shop");
    await expect(page.getByText(/needs a claimed player/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /buy for/i })).toHaveCount(0);
  });
});
