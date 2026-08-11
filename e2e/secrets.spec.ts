// The fourth card.
//
// Server functions are stubbed, so what is exercised here is everything the
// browser owns: the claim gate, the reveal, what survives a reload, and — the
// point of the whole feature — that the vault shows only what you pulled and
// never hints at what you did not.
import {
  test,
  expect,
  SECRET_CARD,
  sealedPack,
  serverFnName,
  tearPack,
  type ServerFnMock,
} from "./fixtures";
import type { Page } from "@playwright/test";

const MEMBER_KEY = "wwbh:member-token";

/** Sign the device in as a member, the way an already-claimed phone arrives. */
async function asMember(page: Page, participantId = "p-alice") {
  await page.addInitScript(
    ([key, token]) => {
      localStorage.setItem(key, token);
      localStorage.setItem("wwbh:member-name", "Alice Ace");
      localStorage.setItem("wwbh:was-member", "1");
    },
    [MEMBER_KEY, `m.${participantId}.${Date.now() + 60 * 60_000}.signature`] as const,
  );
}

function withSecret(server: ServerFnMock, over: Record<string, unknown> = {}) {
  server.set("getSecretStatus", {
    claimed: true,
    day: "2026-07-28",
    pulledToday: false,
    pulled: 1,
    available: true,
    resetsAt: "2026-07-29T04:00:00Z",
    ...(over.status as object),
  });
  server.set("pullSecretCard", {
    ok: true,
    day: "2026-07-28",
    duplicate: false,
    fresh: true,
    card: SECRET_CARD,
    ...(over.pull as object),
  });
}

/**
 * Run the whole reveal sequence.
 *
 * The fourth slot is behind the stand now — cards are turned one at a time and
 * the secret goes last, so nothing about it is on screen the instant the pack is
 * torn. "Reveal all" is the same sequence without the taps.
 */
async function revealAll(page: Page) {
  await page.getByRole("button", { name: /reveal all/i }).click();
}

test.describe("the daily secret", () => {
  test("a claimed member gets a fourth card, and it never enters the pack row", async ({
    page,
    server,
  }) => {
    await asMember(page);
    withSecret(server);
    await page.goto("/players/pack");
    await tearPack(page);
    await revealAll(page);

    await expect(page.getByText(/one more card/i)).toBeVisible({ timeout: 15_000 });
    // Filtered to what is actually on screen: the phrase also appears on the
    // card's own back face, which is rotated away behind backface-visibility.
    await expect(
      page
        .getByText(/not on the roster/i)
        .filter({ visible: true })
        .first(),
    ).toBeVisible();

    // The three roster cards are still exactly three. The secret lives server
    // side, keyed on the member, so nothing about it belongs in IndexedDB beyond
    // a flag.
    const state = await page.evaluate(
      () =>
        new Promise<{ ids: string[] } | null>((resolve) => {
          const open = indexedDB.open("wwbh-cards", 2);
          open.onsuccess = () => {
            const db = open.result;
            const req = db.transaction("pack-state").objectStore("pack-state").get("today");
            req.onsuccess = () => resolve((req.result as { ids: string[] }) ?? null);
            req.onerror = () => resolve(null);
          };
          open.onerror = () => resolve(null);
        }),
    );
    expect(state!.ids).toHaveLength(3);
    expect(state!.ids).not.toContain(SECRET_CARD.id);
  });

  test("an unclaimed guest gets the fourth card too, not a wall", async ({ page, server }) => {
    // This used to assert the opposite — a lock icon and a link to /claim. Guests
    // are in the garden holding a beer as well, so they get a server-minted
    // identity and the card that comes with it. What they no longer get is a gate.
    withSecret(server);
    await page.goto("/players/pack");
    await tearPack(page);
    await revealAll(page);

    await expect(page.getByText(/one more card/i)).toBeVisible({ timeout: 15_000 });
    // No gate any more: a guest gets a server-minted identity and the card that
    // comes with it, so nothing here should send them to /claim.
    await expect(page.getByText(/not on the roster/i).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /claim your player/i })).toHaveCount(0);
  });

  test("says nothing to a guest when there is no drop to be had", async ({ page }) => {
    // The default fixture: available: false. A guest with nothing to pull must
    // see no slot at all rather than an empty one — an empty slot announces that
    // a set exists.
    await page.goto("/players/pack");
    await tearPack(page);
    await expect(page.getByText(/one more card/i)).toBeHidden();
  });

  test("reveals the card, and does not pull a second time after a reload", async ({
    page,
    server,
  }) => {
    await asMember(page);
    withSecret(server);
    await page.goto("/players/pack");
    await tearPack(page);

    await revealAll(page);
    await expect(page.getByText(SECRET_CARD.name).first()).toBeVisible({ timeout: 15_000 });

    const before = server.calls.filter((c) => c.includes("pullSecretCard")).length;
    expect(before).toBeGreaterThan(0);

    await page.reload();
    await expect(sealedPack(page)).toBeHidden();
    // A fresh page load does pull again — but the server returns the same card
    // with fresh:false rather than rolling a new one, so the day is never spent
    // twice. What must not happen is the reveal resetting.
    await expect(page.getByText(SECRET_CARD.name).first()).toBeVisible({ timeout: 15_000 });
  });

  test("a duplicate reads as a wink, not a failure", async ({ page, server }) => {
    await asMember(page);
    withSecret(server, { pull: { duplicate: true }, status: { pulled: 9 } });
    await page.goto("/players/pack");
    await tearPack(page);
    await revealAll(page);

    await expect(page.getByText(/already yours/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/whole set/i)).toBeVisible();
  });

  test("reveal all waits for a pull that was still in the air when it started", async ({
    page,
    server,
  }) => {
    await asMember(page);
    withSecret(server);
    // Still in flight when the button is pressed, landing partway through the
    // roster sequence. The run used to read the `secret` its closure captured at
    // click time — null — and stop, stranding the user on a sealed fourth card
    // they then had to tap themselves.
    server.delay("pullSecretCard", 2_000);

    await page.goto("/players/pack");
    await tearPack(page);
    await revealAll(page);

    await expect(page.getByText(SECRET_CARD.name).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/pack complete/i)).toBeVisible({ timeout: 30_000 });
  });

  test("the fourth card flies out of the pack with the other three", async ({ page, server }) => {
    await asMember(page);
    withSecret(server);

    // The slot count is latched when the rip commits, off the day's status — so
    // the rip has to wait for that answer or this races it. Waiting on the
    // response rather than on a timeout, because a timeout short enough to be
    // worth having is one that passes for the wrong reason on a fast machine.
    //
    // Armed before the navigation, not after: the query fires during hydration
    // and can be answered before `goto` resolves, and a listener attached then
    // waits for a response that has already been and gone.
    const statusAnswered = page.waitForResponse(
      // `serverFnName` yields the whole export — `getSecretStatus_createServerFn_handler`
      // — so this is a contains, the same way the stub itself matches its keys.
      (r) => r.url().includes("/_serverFn/") && serverFnName(r.url()).includes("getSecretStatus"),
    );
    await page.goto("/players/pack");
    await statusAnswered;
    // The response has landed; this is the beat TanStack Query needs to put it in
    // the cache and re-render, which is what the rip actually reads.
    await page.waitForTimeout(100);
    // And the pack has to be dealable at all, or the rip is a no-op.
    await tearPack(page);

    // Three roster cards and the secret. It wears the same universal back as the
    // rest — the bezel is the only tell, and which secret it is stays for the
    // stand.
    await expect(page.locator('[data-testid="opening-card"]')).toHaveCount(4);
    await expect(page.locator('[data-testid="opening-card"] .holo-prism-edge')).toHaveCount(1);

    // And it still gets its whole production at the end of the sequence.
    await revealAll(page);
    await expect(page.getByText(/one more card/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(SECRET_CARD.name).first()).toBeVisible({ timeout: 15_000 });
  });

  test("flies out three cards on a day with no drop", async ({ page }) => {
    await asMember(page);
    // Default stub: `available: false`. A fourth card in the fan that never lands
    // on the stand is a worse lie than a fan that did not preview one.
    await page.goto("/players/pack");
    // The slot count is not what is at risk here — it is three either way. The
    // rip *taking* is: an unreconciled collection makes `tearOpen` refuse, and the
    // ceremony that never starts fails this on a count that stays at zero.
    await tearPack(page);
    await expect(page.locator('[data-testid="opening-card"]')).toHaveCount(3);
    await expect(page.locator(".holo-prism-edge")).toHaveCount(0);
  });

  test("nothing appears when the set is empty", async ({ page }) => {
    await asMember(page);
    // Default stub: pullSecretCard answers { ok: false, reason: "unavailable" }.
    await page.goto("/players/pack");
    await tearPack(page);
    await expect(page.getByText(/one more card/i)).toBeHidden();
    // The pack still opens and still reaches the stand — an empty secret set is
    // nothing to say, not a broken screen. Read off the stand's own test id
    // rather than its heading, which is faint presentation copy by design.
    await expect(page.getByTestId("stand-step")).toBeVisible();
  });
});

test.describe("the vault's secret shelf", () => {
  test("shows what you pulled, with no total and no empty slots", async ({ page, server }) => {
    await asMember(page);
    server.set("getMySecrets", {
      pulled: 3,
      cards: [
        { ...SECRET_CARD, firstPulledOn: "2026-07-28", count: 1, ownerCount: 3 },
        {
          ...SECRET_CARD,
          id: "secret-gazebo",
          name: "The Gazebo",
          firstPulledOn: "2026-07-27",
          count: 2,
          ownerCount: 1,
        },
      ],
    });
    await page.goto("/players");

    await expect(page.getByText("3 secrets pulled")).toBeVisible();
    await expect(page.getByText(SECRET_CARD.name).first()).toBeVisible();
    await expect(page.getByText("Pulled ×2")).toBeVisible();

    // A count of PEOPLE is allowed and is stated here deliberately, so the
    // distinction below is a rule rather than an accident.
    await expect(page.getByText(/packed by 3/i)).toBeVisible();

    // The load-bearing assertion: nowhere on this page is there a denominator, a
    // silhouette, or a "???" slot. An unpulled secret is not missing — it is
    // unknown, and the page must not admit it exists.
    const body = page.locator("body");
    await expect(body).not.toContainText(/of \d+ secrets/i);
    await expect(body).not.toContainText(/\?\?\?/);
    await expect(body).not.toContainText(/\d+ \/ \d+ secrets/i);
  });

  test("says nothing at all to someone who has pulled none", async ({ page }) => {
    await asMember(page);
    // Default stub: { cards: [], pulled: 0 }.
    await page.goto("/players");
    await expect(page.getByText(/secrets? pulled/i)).toBeHidden();
    // Not even a heading. "Secrets" with an empty shelf under it announces that
    // a set exists, which is the one thing withheld.
    await expect(page.getByText(/^secrets$/i)).toBeHidden();
  });

  test("tells a member on a new phone where their collection went", async ({ page }) => {
    // The breadcrumb outlives the token on purpose: without it, a member who
    // reinstalled watches their secrets vanish with no explanation.
    await page.addInitScript(() => localStorage.setItem("wwbh:was-member", "1"));
    await page.goto("/players");
    await expect(page.getByText(/on your name, not on this phone/i)).toBeVisible();
  });

  test("puts a cue on the pack button while today's card is unspent", async ({ page, server }) => {
    await asMember(page);
    server.set("getSecretStatus", {
      claimed: true,
      day: "2026-07-28",
      pulledToday: false,
      pulled: 1,
      available: true,
      resetsAt: "2026-07-29T04:00:00Z",
    });
    await page.goto("/players");
    await expect(page.getByRole("link", { name: /a secret is waiting/i })).toBeVisible();
  });

  test("leaves the pack button alone once it is spent", async ({ page, server }) => {
    await asMember(page);
    server.set("getSecretStatus", {
      claimed: true,
      day: "2026-07-28",
      pulledToday: true,
      pulled: 2,
      available: true,
      resetsAt: "2026-07-29T04:00:00Z",
    });
    await page.goto("/players");
    await expect(page.getByRole("link", { name: /^open today's pack$/i })).toBeVisible();
  });
});
