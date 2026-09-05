// "New since your last visit", in a browser.
//
// The unit tests pin the window rule and the strip's markup; what only a real
// browser proves is the wiring across three stores — the localStorage instant that
// decides what to ask for, the server answer, and the collection the ×N is
// computed from — plus the thing that is easiest to get wrong: that acting on the
// strip actually makes it go away, and stays gone after a reload.
import { expect, test, type ServerFnMock } from "./fixtures";
import type { Page } from "@playwright/test";

const MEMBER_KEY = "wwbh:member-token";
const LAST_SEEN_KEY = "wwbh:vault-last-seen";

async function asMember(page: Page) {
  await page.addInitScript(
    ([key, token]) => {
      localStorage.setItem(key, token);
      localStorage.setItem("wwbh:member-name", "Alice Ace");
    },
    [MEMBER_KEY, `m.p-alice.${Date.now() + 60 * 60_000}.signature`] as const,
  );
}

/** A device that has been here before, so this load is not the silent first visit. */
async function visitedEarlier(page: Page, hoursAgo = 3) {
  await page.addInitScript(
    ([key, at]) => {
      // Only if there is nothing there. An init script runs on EVERY navigation,
      // so an unconditional write would stamp the old visit back over the one the
      // app had just recorded — and every "it stays gone after a reload" assertion
      // below would be testing the fixture rather than the app.
      if (!localStorage.getItem(key)) localStorage.setItem(key, at);
    },
    [LAST_SEEN_KEY, new Date(Date.now() - hoursAgo * 3_600_000).toISOString()] as const,
  );
}

/** Alice, in gold, pulled an hour ago. Held once, so her tile reads NEW. */
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

const GARY = {
  id: "secret-gary",
  name: "Gary The Grill",
  flavour: "Lit at 11am. Still going at 11pm.",
  foil: "rosette",
  artUrl: null,
  backUrl: null,
  tier: "epic",
};

function arrived(page: Page) {
  return page.getByTestId("new-since-strip");
}

async function withArrivals(page: Page, server: ServerFnMock) {
  server.set("getMyCardStats", OWNS_ALICE);
  server.set("getMySecrets", {
    pulled: 1,
    cards: [{ ...GARY, firstPulledOn: "2026-09-05", count: 1, ownerCount: 2 }],
  });
  server.set("getRecentAcquisitions", {
    roster: [
      {
        eventParticipantId: "ep-alice",
        edition: "gold",
        source: "pull",
        acquiredOn: "2026-09-05",
        acquiredAt: new Date(Date.now() - 3_600_000).toISOString(),
      },
    ],
    secrets: [
      {
        id: GARY.id,
        name: GARY.name,
        artUrl: null,
        tier: "epic",
        duplicate: false,
        acquiredAt: new Date(Date.now() - 1_800_000).toISOString(),
      },
    ],
  });
  await asMember(page);
  await visitedEarlier(page);
}

test.describe("new since your last visit", () => {
  test("shows both halves of what arrived, roster and secret", async ({ page, server }) => {
    // Two kinds from two tables, which is the whole reason §12 needed a server
    // function rather than a timestamp: a secret and a roster copy have nothing in
    // common on the client but the instant they landed.
    await withArrivals(page, server);
    await page.goto("/players");

    await expect(arrived(page)).toBeVisible();
    await expect(arrived(page).locator("> li")).toHaveCount(2);
    await expect(page.getByRole("link", { name: "Alice Ace — NEW" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Gary The Grill — .+ — NEW$/ })).toBeVisible();
  });

  test("says nothing at all on a device's first ever visit", async ({ page, server }) => {
    // No stored instant means "we do not know", not "everything is new". A member
    // restoring on a new handset must not get a strip celebrating a collection
    // they built months ago.
    server.set("getMyCardStats", OWNS_ALICE);
    await asMember(page);
    await page.goto("/players");

    await expect(page.getByRole("link", { name: /^Alice Ace/ }).first()).toBeVisible();
    await expect(arrived(page)).toHaveCount(0);
    // And the visit is seeded, so the next one has a window to ask about.
    expect(await page.evaluate((k) => localStorage.getItem(k), LAST_SEEN_KEY)).not.toBeNull();
  });

  test("goes away for good once a card in it has been opened", async ({ page, server }) => {
    await withArrivals(page, server);
    await page.goto("/players");
    await expect(arrived(page)).toBeVisible();

    await page.getByRole("link", { name: "Alice Ace — NEW" }).click();
    // `?view=1` since §7: the strip opens the full-screen viewer, the same as a
    // tap on the shelf below it.
    await expect(page).toHaveURL(/\/players\/ep-alice(\?|$)/);

    // THE LOAD-BEARING PART. The server still answers with the same day's rows —
    // it is asked a stable question — so what makes the strip stay gone is the
    // instant this device stored when the card was tapped. A strip that came back
    // on the next load would be the permanent badge §12 explicitly rules out.
    await page.goto("/players");
    await expect(page.getByRole("link", { name: /^Alice Ace/ }).first()).toBeVisible();
    await expect(arrived(page)).toHaveCount(0);
  });

  test("opens a secret in the sheet rather than at a URL", async ({ page, server }) => {
    // A secret has no address, deliberately, and the strip must not be the place
    // that gives it one.
    await withArrivals(page, server);
    await page.goto("/players");

    await page.getByRole("button", { name: /^Gary The Grill — .+ — NEW$/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page).toHaveURL(/\/players\/?$/);

    // And it stays open. Opening a card also marks the strip seen, which empties
    // the strip — a sheet reading that list live would lose the card out from
    // under the thumb that had just tapped it.
    await expect(arrived(page)).toHaveCount(0);
    await expect(page.getByRole("dialog")).toBeVisible();
    // The heading specifically: the card itself carries its name three times over.
    await expect(page.getByRole("dialog").getByRole("heading", { name: GARY.name })).toBeVisible();
  });

  test("can be dismissed by somebody who has read it", async ({ page, server }) => {
    await withArrivals(page, server);
    await page.goto("/players");
    await expect(arrived(page)).toBeVisible();
    const before = await page.evaluate((k) => localStorage.getItem(k), LAST_SEEN_KEY);

    await page.getByRole("button", { name: /dismiss what's new/i }).click();

    // Instantly, and with no round trip: "since you looked" is a filter over rows
    // already in hand, not a narrower question to the server. Dismissing costing a
    // refetch is what made the row flicker back before it went.
    await expect(arrived(page)).toHaveCount(0);
    expect(await page.evaluate((k) => localStorage.getItem(k), LAST_SEEN_KEY)).not.toBe(before);

    await page.reload();
    await expect(page.getByRole("link", { name: /^Alice Ace/ }).first()).toBeVisible();
    await expect(arrived(page)).toHaveCount(0);
  });
});
