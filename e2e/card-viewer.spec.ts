// The full-screen card viewer (§6, §9).
//
// The component test drives the gestures against a fake DOM; what only a real
// browser proves is the two things the audit actually asked for — that a tap on a
// tile puts the CARD on screen at the size of the phone rather than at the top of
// a stats page, and that getting out of it is one press of whatever a person
// reaches for first: Escape, the ✕, or the phone's own back gesture.
import { expect, test } from "./fixtures";
import { SECRET_CARD } from "./fixtures";
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

const COPY_A = "00000000-0000-4000-8000-0000000000a1";
const COPY_B = "00000000-0000-4000-8000-0000000000a2";

const viewer = (page: Page) => page.getByTestId("card-viewer");

// The tile by its link, not by its text: one tile carries the name three times
// over, and a text match resolves to all three.
const aliceTile = (page: Page) => page.getByRole("link", { name: /^Alice Ace/ }).first();

test.describe("the full-screen card viewer", () => {
  test("a tap on a roster tile shows the card, big, on an address Back can close", async ({
    page,
    server,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "mobile",
      "The size floor is a phone rule; the desktop project has a cap instead of a squeeze.",
    );
    await asMember(page);
    server.set("getMyCardStats", OWNS_ALICE);
    await page.goto("/players");

    await aliceTile(page).click();
    await expect(viewer(page)).toBeVisible();
    // The URL is the whole reason a roster card goes through the router: it is
    // what makes the phone's back gesture close the viewer.
    await expect(page).toHaveURL(/\/players\/ep-alice\?view=1$/);

    // §6's actual ask, measured: "as big as the phone allows". At 390x844 the
    // column's own width binds first, so anything under 300 means the svh clamp
    // in card-viewer.tsx has taken more than its share.
    const box = await page.getByTestId("card-viewer-card").boundingBox();
    expect(box, "the viewer rendered no card at all").not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(300);

    await page.goBack();
    await expect(viewer(page)).toBeHidden();
    await expect(page).toHaveURL(/\/players\/?$/);
  });

  test("Escape and the ✕ both close it", async ({ page, server }) => {
    await asMember(page);
    server.set("getMyCardStats", OWNS_ALICE);
    await page.goto("/players/ep-alice?view=1");
    await expect(viewer(page)).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(viewer(page)).toBeHidden();

    // Nothing behind a deep link to go back to, so closing lands in the vault.
    await expect(page).toHaveURL(/\/players\/?$/);

    await page.goto("/players/ep-alice?view=1");
    await page.getByRole("button", { name: "Close" }).click();
    await expect(viewer(page)).toBeHidden();
  });

  test("Details drops to the stats page, and the page can go back up", async ({ page, server }) => {
    await asMember(page);
    server.set("getMyCardStats", OWNS_ALICE);
    await page.goto("/players/ep-alice?view=1");

    await page.getByRole("button", { name: /details/i }).click();
    await expect(viewer(page)).toBeHidden();
    await expect(page).toHaveURL(/\/players\/ep-alice$/);
    // The details page's own controls, which is what the second step is for.
    // (Not a stat tile: the card's BACK carries the same words in a panel that is
    // in the DOM and turned away from the camera.)
    await expect(page.getByRole("button", { name: /^compare$/i })).toBeVisible();

    await page.getByRole("button", { name: /view full screen/i }).click();
    await expect(viewer(page)).toBeVisible();
  });

  test("a card nobody has packed opens face-down, with the way to unlock it", async ({
    page,
    server,
  }) => {
    await asMember(page);
    server.set("getMyCardStats", OWNS_ALICE);
    await page.goto("/players/ep-bob?view=1");

    await expect(viewer(page)).toBeVisible();
    await expect(
      viewer(page).getByRole("link", { name: /rip a pack to see this card/i }),
    ).toBeVisible();
    // The tier of a card you have not packed is the one thing the face-down slot
    // exists to withhold — the same rule the vault's rarity sort goes to lengths
    // to keep.
    await expect(viewer(page).getByRole("button", { name: "Flip" })).toBeDisabled();
  });

  test('"Offer this card" arrives at the Trading Post with the card in mind', async ({
    page,
    server,
  }) => {
    await asMember(page);
    // Two copies, so there is a spare to offer — the menu item exists only then.
    server.set("getMyCardStats", {
      ...OWNS_ALICE,
      cards: [{ ...OWNS_ALICE.cards[0], pullCount: 2 }],
    });
    server.set("getClaimRoster", [
      {
        id: "p-alice",
        name: "Alice Ace",
        nickname: null,
        hasCode: true,
        claimed: true,
        reachable: true,
      },
      {
        id: "p-bob",
        name: "Bob Blitz",
        nickname: null,
        hasCode: true,
        claimed: true,
        reachable: true,
      },
    ]);
    // One stub answers for both sides; the handler is the same one either way.
    server.set("getTradeSpares", {
      participantId: "p-alice",
      ownedRoster: [],
      blocked: [],
      secrets: [],
      roster: [
        { copyId: COPY_A, eventParticipantId: "ep-alice", edition: "gold", viewerOwns: true },
        { copyId: COPY_B, eventParticipantId: "ep-alice", edition: "standard", viewerOwns: true },
      ],
    });

    await page.goto("/players/ep-alice?view=1");
    // Scoped to the viewer: the details page behind it carries its own overflow
    // trigger with the same name. It is `inert` under the viewer, but scoping is
    // what makes this test independent of how Playwright treats that.
    await viewer(page).getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: /offer this card/i }).click();

    await expect(page).toHaveURL(/\/players\/trade$/);
    // The intent, said out loud — somebody arrives here mid-thought.
    await expect(page.getByText(/Offering your spare Alice Ace/i)).toBeVisible();

    // And staged the moment there is somebody to send it to. The PLAINEST spare:
    // you offered the card, not your gold copy of it.
    await page.getByRole("button", { name: "Bob Blitz" }).click();
    await expect(page.getByText(/You give \(1\/4\)/)).toBeVisible();
    // A standard copy prints no finish at all (editionLabel is null for 70% of
    // them), so the gold one NOT being the staged one is what says which copy
    // went in.
    await expect(page.getByRole("button", { name: /Gold/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  test("a secret opens the same viewer and never touches the URL", async ({ page, server }) => {
    await asMember(page);
    server.set("getMySecrets", {
      pulled: 2,
      cards: [
        {
          ...SECRET_CARD,
          borderFx: "none",
          collection: null,
          tier: "mythic",
          firstPulledOn: "2026-07-28",
          count: 2,
          ownerCount: 3,
        },
      ],
    });
    await page.goto("/players");

    await page
      .getByRole("button", { name: /^Gary The Grill/ })
      .first()
      .click();
    await expect(viewer(page)).toBeVisible();
    // The load-bearing assertion of this whole file: a secret card has no
    // address, because an address is shareable.
    await expect(page).toHaveURL(/\/players\/?$/);
    await expect(viewer(page).getByText(/Pulled ×2/)).toBeVisible();
    await expect(viewer(page).getByText(/Packed by 3/)).toBeVisible();

    // And still no denominator anywhere, viewer included.
    await expect(page.locator("body")).not.toContainText(/of \d+ secrets/i);
    await expect(page.locator("body")).not.toContainText(/\d+ \/ \d+ secrets/i);

    await page.keyboard.press("Escape");
    await expect(viewer(page)).toBeHidden();
    await expect(page).toHaveURL(/\/players\/?$/);
  });
});
