// Three levels of button glow, proved in a browser.
//
// The companion to rarity-glow.spec.ts, and the same argument one layer up: a
// card only blooms if its rank earned it, and a control only blooms if it is the
// thing to press. Every neon size used to carry the full two-layer
// --glow-primary at rest, so the Vault lit three buttons, the pack summary four
// and the trade builder four, and none of them was the answer to "what now".
//
// Only a real browser can answer this. The three levels are three CSS custom
// properties resolved through a component-layer cascade where ties break on
// source order — a class-name assertion would prove the markup and nothing about
// which shadow actually paints.
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

/** A rung standing unclaimed, which is what puts a secondary button beside Open Pack. */
const CLAIMABLE = {
  kind: "member",
  current: 3,
  startedOn: "2026-07-26",
  lastOpenedOn: "2026-07-28",
  openedToday: false,
  today: "2026-07-28",
  canClaim: true,
  milestones: [
    { days: 3, label: "Three Days", blurb: "A bonus secret, on the house.", tierFloor: null, earned: true, claimed: false }, // prettier-ignore
  ],
};

/**
 * How much light a control throws, as the number of shadow layers with a real
 * blur radius.
 *
 * Split on commas OUTSIDE the colour function, then read each layer's third
 * length — x, y, blur, spread. Counting blurs with one regex over the whole
 * string does not work: `0px 0px 0px 1px` contains `0px 0px 1px` starting one
 * token in, so every hairline reads as a glow and a hero comes back as four
 * layers rather than two.
 */
function glowLayers(shadow: string) {
  return shadow.split(/,(?![^(]*\))/).filter((layer) => {
    const lengths = layer.replace(/\b[a-z]+\([^)]*\)/gi, "").match(/-?[\d.]+px/g) ?? [];
    return lengths.length >= 3 && parseFloat(lengths[2]) > 0;
  }).length;
}

function shadowOf(page: Page, name: RegExp) {
  return page
    .getByRole("button", { name })
    .or(page.getByRole("link", { name }))
    .first()
    .evaluate((el) => getComputedStyle(el).boxShadow);
}

test.describe("one scale of button glow", () => {
  test("blooms the screen's one action and leaves the secondary one flat", async ({
    page,
    server,
  }) => {
    await asMember(page);
    server.set("getStreakStatus", CLAIMABLE);
    await page.goto("/players");

    const hero = page.getByRole("link", { name: /^open today's pack/i });
    const secondary = page.getByRole("button", { name: /claim three days/i });
    await expect(hero).toBeVisible();
    await expect(secondary).toBeVisible();

    // Ceremonial: --glow-primary is two blurred layers, and it is the only place
    // on an ordinary screen that gets them.
    expect(glowLayers(await shadowOf(page, /^open today's pack/i))).toBe(2);

    // Secondary: the cyan rim and the inset hairline, neither of which is a
    // blur. A 44px pill next to the day's action is not a second answer to the
    // same question.
    expect(glowLayers(await shadowOf(page, /claim three days/i))).toBe(0);
  });

  test("gives a refused control no glow at all", async ({ page, server }) => {
    // Offline, which is the state every spend button in this app has to survive.
    await asMember(page);
    server.set("getStreakStatus", CLAIMABLE);
    await page.goto("/players");
    await expect(page.getByRole("button", { name: /claim three days/i })).toBeVisible();
    await page.context().setOffline(true);

    const claim = page.getByRole("button", { name: /claim three days/i });
    await expect(claim).toBeDisabled();
    // Polled, not read once: box-shadow transitions over 120ms, and a single
    // read lands mid-interpolation on a half-faded hairline rather than on the
    // value the rule actually sets.
    await expect.poll(() => claim.evaluate((el) => getComputedStyle(el).boxShadow)).toBe("none");
  });
});
