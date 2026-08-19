// Pinning cards to the top of the vault.
//
// The unit tests cover the store and the button in isolation; what only a real
// browser proves is the wiring — that the star does not follow the link it sits
// on, that a pinned card moves shelves rather than appearing on two, and that the
// choice survives a reload.
import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";

const MEMBER_KEY = "wwbh:member-token";

async function asMember(page: Page) {
  await page.addInitScript(
    ([key, token]) => {
      localStorage.setItem(key, token);
      localStorage.setItem("wwbh:member-name", "Alice Ace");
    },
    [MEMBER_KEY, `m.p-alice.${Date.now() + 60 * 60_000}.signature`] as const,
  );
}

/** Alice packed, in gold. Everyone else is still face-down. */
const OWNS_ALICE = {
  cards: [
    {
      eventParticipantId: "ep-alice",
      pullCount: 1,
      edition: "gold",
      firstPulledAt: "2026-07-28T10:00:00Z",
    },
  ],
  packsOpened: 1,
  firstPackOn: "2026-07-28",
};

const rosterShelf = (page: Page) =>
  page.locator("section").filter({ has: page.getByRole("heading", { name: "Roster" }) });

const favouritesShelf = (page: Page) =>
  page.locator("section").filter({ has: page.getByRole("heading", { name: "Favourites" }) });

// The tile by its link, not by its text: one tile carries the name three times
// over (the holo card's sr-only label, its caption, and the tile caption), and a
// text match resolves to all three.
const aliceIn = (shelf: ReturnType<typeof rosterShelf>) =>
  shelf.getByRole("link", { name: /^Alice Ace/ });

test.describe("pinning cards to the top", () => {
  test("moves a pinned card onto a shelf of its own without navigating", async ({
    page,
    server,
  }) => {
    await asMember(page);
    server.set("getMyCardStats", OWNS_ALICE);
    await page.goto("/players");

    const pin = page.getByRole("button", { name: "Pin Alice Ace to the top" });
    await expect(pin).toBeVisible();
    // Nothing pinned yet, so the shelf does not exist at all.
    await expect(favouritesShelf(page)).toHaveCount(0);
    await expect(aliceIn(rosterShelf(page))).toBeVisible();

    await pin.click();

    // The load-bearing one: the star sits inside the <Link> that wraps the whole
    // tile, so a click that reached it would open Alice's page instead.
    await expect(page).toHaveURL(/\/players\/?$/);

    await expect(aliceIn(favouritesShelf(page))).toBeVisible();
    // Moved, not copied.
    await expect(aliceIn(rosterShelf(page))).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Unpin Alice Ace from the top" })).toBeVisible();
  });

  test("keeps the pin, and the finish, across a reload", async ({ page, server }) => {
    await asMember(page);
    server.set("getMyCardStats", OWNS_ALICE);
    await page.goto("/players");
    await page.getByRole("button", { name: "Pin Alice Ace to the top" }).click();
    await expect(aliceIn(favouritesShelf(page))).toBeVisible();

    await page.reload();

    // The pinned tile wears the best copy you hold, which is what the roster tile
    // showed before it moved — the shelf must not flatten it to standard.
    await expect(
      favouritesShelf(page).getByRole("link", { name: /^Alice Ace.*Gold/i }),
    ).toBeVisible();
  });

  test("draws no star on a card nobody has packed", async ({ page }) => {
    // You cannot pin what you have not seen, and a pinned face-down slot would
    // have no copy to show.
    await asMember(page);
    await page.goto("/players");
    await expect(page.getByRole("button", { name: /^Pin / })).toHaveCount(0);
  });

  test("unpinning sends the card back to its shelf", async ({ page, server }) => {
    await asMember(page);
    server.set("getMyCardStats", OWNS_ALICE);
    await page.goto("/players");
    await page.getByRole("button", { name: "Pin Alice Ace to the top" }).click();
    await expect(favouritesShelf(page)).toHaveCount(1);

    await page.getByRole("button", { name: "Unpin Alice Ace from the top" }).click();

    await expect(favouritesShelf(page)).toHaveCount(0);
    await expect(aliceIn(rosterShelf(page))).toBeVisible();
  });
});
