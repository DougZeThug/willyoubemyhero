// The dust economy's own screen, and the tab that comes and goes with it.
//
// The tab is the only part of this app's chrome that is conditional, so the two
// states are worth pinning in both directions: a bar that keeps a Shop tab after
// the commissioner switches dust off is a tab leading to "not yet", and a bar
// that never grows one is a screen nobody can reach.
//
// And the one transaction with a dialog in front of it. Selling a secret has no
// last-copy rule in SQL — any copy sells, which is the feature — so the confirm
// is the only thing between a thumb and a vanished mythic, and a browser is the
// only place a real `confirm()` can be exercised.
import { test, expect, BUNDLE, type ServerFnMock } from "./fixtures";
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

test.describe("selling a secret", () => {
  const PULL = "00000000-0000-4000-8000-0000000000a1";

  /** One legendary on the counter, plus the switch and the claimed member it needs. */
  async function shopWithSecret(
    page: Page,
    server: ServerFnMock,
    over: Record<string, unknown> = {},
  ) {
    await asMember(page);
    server.set("getActiveEvent", withDust(true));
    server.set("getDustBalance", { balance: 0 });
    server.set("getTradeSpares", {
      participantId: "p-alice",
      ownedRoster: [],
      roster: [],
      secrets: [
        {
          pullId: PULL,
          name: "Gary The Grill",
          artUrl: null,
          tier: "legendary",
          lastCopy: false,
          viewerOwns: true,
          ...over,
        },
      ],
      blocked: [],
    });
    // Mutations are never defaulted in fixtures.ts — an undefaulted handler falls
    // through rather than quietly succeeding — so the stub reads here, next to the
    // assertions it feeds.
    server.set("sellSecretCard", {
      ok: true,
      awarded: 120,
      tier: "legendary",
      secretCardId: "sc-gary",
      balance: 120,
    });
    await page.goto("/players/shop");
  }

  test("prices the copy by its own level and banks the dust", async ({ page, server }) => {
    await shopWithSecret(page, server);

    const sell = page.getByRole("button", { name: /sell \+120/i });
    await expect(sell).toBeVisible();
    // The level rides beside the name, so a mythic is never mistaken for a common
    // at the moment somebody decides to part with it.
    await expect(page.getByText("Gary The Grill")).toBeVisible();
    await expect(page.getByText(/^legendary$/i).first()).toBeVisible();

    await sell.click();
    // The response carries the new balance and the panel writes it straight in,
    // so the header moves without a refetch.
    await expect(page.getByText(/you have 120/i)).toBeVisible();
  });

  test("asks before the last copy goes, and keeps it when you say no", async ({ page, server }) => {
    await shopWithSecret(page, server, { lastCopy: true });

    // Playwright auto-dismisses dialogs unless a handler says otherwise, so
    // "dismiss" is the default — assert on the message rather than on the absence
    // of one, or this passes for the wrong reason.
    let asked = "";
    page.on("dialog", (d) => {
      asked = d.message();
      void d.dismiss();
    });

    await expect(page.getByText(/last copy/i)).toBeVisible();
    await page.getByRole("button", { name: /sell \+120/i }).click();

    await expect.poll(() => asked).toMatch(/only gary the grill/i);
    // Dismissed, so nothing was sold and the balance never moved.
    expect(server.calls.filter((c) => c.includes("sellSecretCard"))).toHaveLength(0);
    await expect(page.getByText(/you have 0/i)).toBeVisible();
  });

  test("goes through once the last copy is confirmed", async ({ page, server }) => {
    await shopWithSecret(page, server, { lastCopy: true });
    page.on("dialog", (d) => void d.accept());

    await page.getByRole("button", { name: /sell \+120/i }).click();

    await expect(page.getByText(/you have 120/i)).toBeVisible();
  });

  test("prints the ladder beside the mill's, so the two are read together", async ({
    page,
    server,
  }) => {
    // The flat "a duplicate secret pays 25" line is gone — nothing is credited on
    // a pull any more — and what replaced it is a second column of five rungs.
    await shopWithSecret(page, server);
    const where = page.locator("section", { hasText: /where dust comes from/i }).last();
    await expect(where).not.toContainText(/duplicate secret pays/i);
    for (const rung of ["Mythic", "Legendary", "Epic", "Rare", "Common"]) {
      await expect(where.getByText(rung, { exact: true })).toBeVisible();
    }
  });
});
