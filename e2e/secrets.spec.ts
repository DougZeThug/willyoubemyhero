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
    // Null on all but one pull in a season, and the default here for the same
    // reason: a spec that wants the completion ceremony overrides it explicitly.
    completedCollection: null,
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
    // comes with it, so nothing here should send them to /claim. Filtered to
    // what is actually on screen, as in the member test above: the phrase also
    // appears on the card's own back face, rotated away behind
    // backface-visibility.
    await expect(
      page
        .getByText(/not on the roster/i)
        .filter({ visible: true })
        .first(),
    ).toBeVisible();
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

  test("tapping try again after a failed pull actually pulls", async ({ page, server }) => {
    // The retry cleared its latch and three state flags, none of which the pull
    // effect depended on — so the effect never re-ran, nothing was requested,
    // and with every flag false the slot computed to "hidden" and the fourth
    // card simply vanished.
    await asMember(page);
    withSecret(server);
    server.fail("pullSecretCard", "offline");
    await page.goto("/players/pack");
    await tearPack(page);
    await revealAll(page);

    const retry = page.getByRole("button", { name: /tap to try again/i });
    await expect(retry).toBeVisible();

    server.recover("pullSecretCard");
    const before = server.calls.filter((c) => c.includes("pullSecretCard")).length;
    await retry.click();

    await expect
      .poll(() => server.calls.filter((c) => c.includes("pullSecretCard")).length)
      .toBeGreaterThan(before);
    // And the slot stays on screen rather than disappearing on the way.
    await expect(page.getByText(/one more card/i)).toBeVisible();
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

  /**
   * The handover from the third card to the fourth, driven by a thumb.
   *
   * By hand rather than through "Reveal all", and that is the whole point of the
   * test. The automatic run sets `busy`, which skips the fake ending outright —
   * so the sequence this covers is the one no spec here ever exercised, and the
   * one where the last roster card used to end up on screen over the secret.
   */
  test("clears the third card off the stand before the fourth arrives", async ({
    page,
    server,
  }) => {
    await asMember(page);
    withSecret(server);
    const statusAnswered = page.waitForResponse(
      (r) => r.url().includes("/_serverFn/") && serverFnName(r.url()).includes("getSecretStatus"),
    );
    await page.goto("/players/pack");
    await statusAnswered;
    await page.waitForTimeout(100);
    await tearPack(page);

    const card = page.locator('[role="button"][aria-pressed]').first();
    const step = page.getByTestId("stand-step");
    await expect(step).toHaveText("1 / 3");

    /** Throw the card away leftward, the way the stand's own gesture reads. */
    async function swipeNext() {
      const box = (await card.boundingBox())!;
      const y = box.y + box.height / 2;
      await page.mouse.move(box.x + box.width * 0.85, y);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.15, y, { steps: 4 });
      await page.mouse.up();
    }

    // Walk the roster by hand, turning each card and throwing it away.
    for (let n = 1; n <= 3; n++) {
      await expect(step).toHaveText(`${n} / 3`);
      await card.click();
      await expect(page.getByText(/swipe/i).first()).toBeVisible({ timeout: 15_000 });
      const name = await card.getAttribute("aria-labelledby");
      const third = n === 3 ? await page.locator(`#${name}`).innerText() : null;
      await swipeNext();
      if (!third) continue;

      // The handover, sampled. Two things must hold on every frame of it: the
      // payoff line is never on screen over the card before it, and there is a
      // beat where the stand is genuinely empty rather than one card swapping
      // for another.
      let sawBareStage = false;
      for (let i = 0; i < 100; i++) {
        const heading = (await step.innerText()).trim();
        const onStage = await page.locator('[role="button"][aria-pressed]').count();
        const thirdStillUp = await page.getByText(third, { exact: true }).count();
        if (/one more card/i.test(heading)) {
          expect(thirdStillUp, "the payoff line arrived over the third card").toBe(0);
          break;
        }
        if (onStage === 0) sawBareStage = true;
        await page.waitForTimeout(40);
      }
      expect(sawBareStage, "the stand never emptied between the third card and the fourth").toBe(
        true,
      );
    }

    await expect(step).toHaveText(/one more card/i);

    // And revealing it does not put the roster card back. `secretSlot` moves
    // "sealed" to "open" here, which is exactly what used to re-run the fake
    // ending from the top.
    await card.click();
    await expect(page.getByText(SECRET_CARD.name).first()).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(2_000);
    await expect(step).toHaveText(/one more card/i);
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
    // Scoped to the page: the nav's Pack tab wears the same cue and the same
    // wording, so an unscoped match finds two links and fails on strict mode.
    await expect(
      page.getByRole("main").getByRole("link", { name: /a secret is waiting/i }),
    ).toBeVisible();
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
