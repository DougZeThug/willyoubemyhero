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

/**
 * How the binder reads, and where it starts.
 *
 * The sort chips, Rearrange and the four counters above them were most of the
 * ~640px the audit measured before the first card at 390 (§3, §17). These are
 * the two halves of the fix: one control instead of six, and a floor under how
 * far down the page the binder is allowed to begin.
 */
test.describe("sort & filter", () => {
  test("keeps every reading choice on this device", async ({ page, server }) => {
    await asMember(page);
    server.set("getMyCardStats", OWNS_ALICE);
    await page.goto("/players");
    // The shelf header ships in the SSR html and the grid does not, so waiting
    // for a tile is waiting for hydration. A tap any earlier lands on a button
    // React has not adopted yet and does nothing at all — the same trap the
    // rarity-sort journey documents.
    await expect(aliceIn(rosterShelf(page))).toBeVisible();

    await page.getByRole("button", { name: /sort and filter/i }).click();
    await page.getByRole("button", { name: "Newest" }).click();
    await page.getByRole("button", { name: "Owned" }).click();
    await page.getByRole("button", { name: "3 across" }).click();
    await page.keyboard.press("Escape");

    // Owned, so the twelve face-down slots are gone and only Alice is left.
    await expect(page.getByRole("img", { name: /not packed yet/ })).toHaveCount(0);
    await expect(aliceIn(rosterShelf(page))).toBeVisible();

    await page.reload();
    await expect(aliceIn(rosterShelf(page))).toBeVisible();
    await page.getByRole("button", { name: /sort and filter/i }).click();
    for (const [name, pressed] of [
      ["Newest", "true"],
      ["Owned", "true"],
      ["3 across", "true"],
      ["Name", "false"],
    ] as const) {
      await expect(page.getByRole("button", { name })).toHaveAttribute("aria-pressed", pressed);
    }
  });

  test("says why a shelf is empty rather than looking like it lost cards", async ({
    page,
    server,
  }) => {
    await asMember(page);
    server.set("getMyCardStats", OWNS_ALICE);
    await page.goto("/players");
    await expect(aliceIn(rosterShelf(page))).toBeVisible();
    await page.getByRole("button", { name: /sort and filter/i }).click();
    await page.getByRole("button", { name: "Spares" }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByText(/no spares yet/i)).toBeVisible();
  });

  test("puts a copy count on a card somebody holds more than one of", async ({ page, server }) => {
    // The one number that makes a card TRADEABLE, and until now it appeared only
    // on secrets and on the detail slab — nowhere near where trading decisions
    // start (§5).
    await asMember(page);
    server.set("getMyCardStats", {
      ...OWNS_ALICE,
      cards: [{ ...OWNS_ALICE.cards[0], pullCount: 3 }],
    });
    await page.goto("/players");
    await expect(rosterShelf(page).getByText("×3")).toBeVisible();
    // Never on a face-down slot: there is no copy to count, and a pip there
    // would say the slot is yours.
    await expect(rosterShelf(page).getByText(/^×\d+$/)).toHaveCount(1);
  });

  test("starts the binder inside the first screen at 390", async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "mobile",
      "A fold is a phone measurement; the desktop project is 720 tall and passes for free.",
    );
    // 390x844 is the mobile project's own size (iPhone 13), and the width every
    // number in §17 was measured at. Before this the vault spent ~640px of
    // header and, at 320, showed no card at all.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/players");
    const firstTile = rosterShelf(page).getByRole("link", { name: /^Alice Ace/ });
    await expect(firstTile).toBeVisible();
    const box = (await firstTile.boundingBox())!;
    expect(box.y).toBeLessThan(844);
  });
});
