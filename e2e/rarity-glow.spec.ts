// One scale of glow, proved in a browser.
//
// §8 of the mobile audit: every owned tile used to bloom in its tier colour, so
// a shelf of base cards looked exactly as special as a champion and nothing on
// the page was the top of anything. The rule is now that a tile only glows if
// its rank earned it — champion and podium, gold and platinum, legendary and
// mythic — and everything else stays flat.
//
// Only a real browser can answer this. The shadow is an inline style built from
// three flags across three modules, and it is *replacing* the element's own
// Tailwind shadow-2xl rather than adding to it — a jsdom render would report the
// inline string back without ever resolving which of the two actually paints.
import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";
import { BUNDLE } from "./fixtures";

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

// Carol is the third of three finishers, so the ladder would make her podium —
// which glows. The admin override is the shortest honest way to a base card in
// this fixture, and it is a real product path: rarityMap takes card_rarity over
// anything it would work out for itself.
const WITH_A_BASE_CARD = {
  ...BUNDLE,
  participants: BUNDLE.participants.map((p) =>
    p.id === "ep-carol" ? { ...p, card_rarity: "base" } : p,
  ),
};

/** Alice, who won, and Carol, who did not. Both in standard, so only the tier differs. */
const OWNS_BOTH = {
  cards: [
    {
      eventParticipantId: "ep-alice",
      pullCount: 1,
      edition: "standard",
      firstPulledAt: "2026-07-28T10:00:00Z",
    },
    {
      eventParticipantId: "ep-carol",
      pullCount: 1,
      edition: "standard",
      firstPulledAt: "2026-07-28T10:00:00Z",
    },
  ],
  packsOpened: 1,
  firstPackOn: "2026-07-28",
};

/**
 * The computed shadow on one tile's card.
 *
 * `.shadow-2xl` is the card element itself — the one place holo-card.tsx puts
 * the tier bloom, and the class is in source so grep finds it. The tile by its
 * link, per the note in favourites.spec.ts: the name appears three times inside
 * one tile and a text match resolves to all of them.
 */
function shadowOf(page: Page, name: RegExp) {
  return page
    .getByRole("link", { name })
    .locator(".shadow-2xl")
    .evaluate((el) => getComputedStyle(el).boxShadow);
}

test.describe("tile glow by rank", () => {
  test("blooms a champion tile and leaves a base tile flat", async ({ page, server }) => {
    await asMember(page);
    server.set("getEventBundle", WITH_A_BASE_CARD);
    server.set("getMyCardStats", OWNS_BOTH);
    await page.goto("/players");

    await expect(page.getByRole("link", { name: /^Alice Ace/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Carol Crush/ })).toBeVisible();

    const [champion, base] = await Promise.all([
      shadowOf(page, /^Alice Ace/),
      shadowOf(page, /^Carol Crush/),
    ]);

    // The champion wears its own colour. Every tier colour in the app is an
    // oklch() literal, and nothing else on this element is, so "carries an
    // oklch layer" is precisely "has a coloured glow".
    expect(champion).toContain("oklch");

    // The base tile keeps shadow-2xl — a neutral black drop shadow, so the tile
    // still lifts off the page — and nothing tinted on top of it. Asserting the
    // absence of a colour rather than the absence of a shadow is the point: the
    // bug this guards is a tinted bloom coming back, not a flat card.
    expect(base).not.toContain("oklch");
    expect(base).toMatch(/rgba?\(0, ?0, ?0/);
    expect(champion).not.toBe(base);
  });
});
