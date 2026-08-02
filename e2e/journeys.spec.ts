// The flows that matter: getting in, seeing results, and opening a pack.
import { test, expect, BUNDLE, EVENT_ID, PLAYERS, stubServerFns } from "./fixtures";
// The same pure functions the pack route deals from, so these tests can compute
// the pack they expect rather than guess at one. With a four-player fixture and
// a three-card pack, "assert two packs differ" collides often enough to be flaky;
// "assert this pack is the one this identity earns" never does.
import { dealPack, packSeed } from "../src/lib/pack";

const MEMBER_KEY = "wwbh:member-token";
/** Matches playwright.config.ts. Pages opened via browser.newPage() get no baseURL. */
const BASE_URL = `http://127.0.0.1:${process.env.E2E_PORT ?? 5199}`;
const ADMIN_KEY = "wwbh:admin-token";

test.describe("claiming a player", () => {
  test("a wrong code leaves you signed out", async ({ page, server }) => {
    server.set("claimPlayer", { ok: false, reason: "bad_code" });
    await page.goto("/claim");

    await page.getByRole("button", { name: /Alice Ace/i }).click();
    await page.getByRole("textbox").fill("WRONG7");
    await page
      .getByRole("button", { name: /claim|unlock|submit/i })
      .last()
      .click();

    await expect(page.getByText(/doesn't match|does not match/i)).toBeVisible();
    expect(await page.evaluate((k) => localStorage.getItem(k), MEMBER_KEY)).toBeNull();
    await expect(page).toHaveURL(/\/claim/);
  });

  test("the right code signs you in and sends you to the vault", async ({ page, server }) => {
    server.set("claimPlayer", {
      ok: true,
      token: `m.p-alice.${Date.now() + 90 * 24 * 60 * 60_000}.signature`,
      expiresAt: Date.now() + 90 * 24 * 60 * 60_000,
      name: "Alice Ace",
    });
    await page.goto("/claim");

    await page.getByRole("button", { name: /Alice Ace/i }).click();
    await page.getByRole("textbox").fill("ACDEF4");
    await page
      .getByRole("button", { name: /claim|unlock|submit/i })
      .last()
      .click();

    await expect(page).toHaveURL(/\/players/);
    expect(await page.evaluate((k) => localStorage.getItem(k), MEMBER_KEY)).toContain("m.p-alice.");
    expect(await page.evaluate(() => localStorage.getItem("wwbh:member-name"))).toBe("Alice Ace");
  });

  test("an already-claimed device offers to sign out", async ({ page }) => {
    await page.addInitScript(
      ([key, token]) => {
        localStorage.setItem(key, token);
        localStorage.setItem("wwbh:member-name", "Alice Ace");
      },
      [MEMBER_KEY, `m.p-alice.${Date.now() + 60_000}.signature`] as const,
    );
    await page.goto("/claim");
    await expect(page.getByRole("button", { name: /sign out|log out/i })).toBeVisible();
  });
});

test.describe("the commissioner console", () => {
  // The PIN field is type="password", so it has no textbox role — and the form
  // submits itself the moment a fourth digit lands, without touching the button.
  const pinField = (page: import("@playwright/test").Page) => page.getByLabel("Event PIN");

  test("stays locked for a wrong PIN", async ({ page, server }) => {
    server.set("verifyEventPin", { ok: false, reason: "bad_pin" });
    await page.goto("/admin");

    await pinField(page).fill("0000");
    await expect(page.getByText(/incorrect pin/i)).toBeVisible();

    expect(await page.evaluate((k) => localStorage.getItem(k), ADMIN_KEY)).toBeNull();
    // Still the gate, not the console.
    await expect(page.getByRole("button", { name: /unlock/i })).toBeVisible();
  });

  test("unlocks and stores a token for the right PIN", async ({ page, server }) => {
    const expiresAt = Date.now() + 12 * 60 * 60_000;
    server.set("verifyEventPin", {
      ok: true,
      token: `${BUNDLE.event.id}.${expiresAt}.signature`,
      expiresAt,
    });
    await page.goto("/admin");

    await pinField(page).fill("8675");

    await expect
      .poll(() => page.evaluate((k) => localStorage.getItem(k), ADMIN_KEY), { timeout: 15_000 })
      .toContain(BUNDLE.event.id);
    // The gate is gone once the token lands.
    await expect(page.getByLabel("Event PIN")).toBeHidden();
  });

  test("strips anything that is not a digit", async ({ page, server }) => {
    server.set("verifyEventPin", { ok: false, reason: "bad_pin" });
    await page.goto("/admin");

    // Stops at three digits on purpose: a fourth would auto-submit, and a
    // rejected PIN clears the field, so there would be nothing left to assert.
    const field = pinField(page);
    await field.pressSequentially("1a2b3");
    await expect(field).toHaveValue("123");
  });
});

test.describe("results", () => {
  test("the leaderboard orders the field fastest first", async ({ page }) => {
    await page.goto("/leaderboard");
    const body = page.locator("body");
    await expect(body).toContainText("Alice Ace");

    // innerText reflects the rendered result, and the roster is styled
    // uppercase, so the comparison has to be case-insensitive.
    const text = (await body.innerText()).replace(/\s+/g, " ").toLowerCase();
    const order = PLAYERS.filter((p) => p.timeMs != null).map((p) =>
      text.indexOf(p.name.toLowerCase()),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    // 50s, then 60s, then 70s.
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  test("the leaderboard formats times rather than printing raw milliseconds", async ({ page }) => {
    await page.goto("/leaderboard");
    await expect(page.locator("body")).toContainText("50.00");
    await expect(page.locator("body")).not.toContainText("50000");
  });

  test("the live view shows the field and does not crash with nobody running", async ({ page }) => {
    await page.goto("/live");
    await expect(page.locator("body")).toContainText(/standby|live|spectator/i);
    await expect(page.locator("body")).toContainText("Alice Ace");
  });

  test("the vault lists every player on the roster", async ({ page }) => {
    await page.goto("/players");
    for (const player of PLAYERS) {
      await expect(page.locator("body")).toContainText(player.name);
    }
  });
});

test.describe("a player's card", () => {
  test("shows the champion's tier, and says why", async ({ page }) => {
    await page.goto("/players/ep-alice");
    // Alice owns the fastest official time in the fixture bundle.
    await expect(page.locator("body")).toContainText("Alice Ace");
    await expect(page.locator("body")).toContainText(/1 of 1/i);
    await expect(page.locator("body")).toContainText(/fastest official time/i);
  });

  test("shows the DNF tier for a scratched player", async ({ page }) => {
    await page.goto("/players/ep-dave");
    await expect(page.locator("body")).toContainText("Dave Dnf");
    await expect(page.locator("body")).toContainText(/DNF|did not finish/i);
  });

  /**
   * This used to assert a "Claim your player" link on the card, and had been
   * failing since a22f1dd removed the one it was looking for. That commit was
   * not a regression: it deleted the claim gate on purpose and let guests join
   * in by naming themselves on the device instead — which is why the server
   * says "Claim your player *or add a name* to join in".
   *
   * So the behaviour worth pinning is the replacement, not the thing that went.
   * The load-bearing part is that the tap survives: a guest who reacts, gets
   * asked who they are, and answers should not then have to react again.
   */
  test("asks a signed-out visitor for a name before their first reaction", async ({ page }) => {
    await page.goto("/players/ep-alice");

    const prompt = page.getByText(/what should we call you/i);
    const react = page.getByRole("button", { name: /react with/i }).first();

    // Not gated: a guest may tap, and is asked only once they actually do.
    await expect(react).toBeEnabled();
    await expect(prompt).toBeHidden();

    await react.click();
    await expect(prompt).toBeVisible();

    await page.getByPlaceholder("Your name").fill("Garden Guest");
    await page.getByRole("button", { name: /^save$/i }).click();

    // Gone, and the name is now the one offered for trash talk — which is how
    // the page shows it took the answer rather than just closing the form.
    await expect(prompt).toBeHidden();
    await expect(page.getByPlaceholder(/talk your talk, garden guest/i)).toBeVisible();
  });
});

test.describe("opening a pack", () => {
  const PACK_SIZE = 3;

  /** Today's pack row straight out of IndexedDB, or null if nothing is stored. */
  type PackState = { dayKey: string; ids: string[]; revealed: number[]; cursor?: number };

  function readPackState(page: import("@playwright/test").Page) {
    return page.evaluate(
      () =>
        new Promise<PackState | null>((resolve) => {
          const open = indexedDB.open("wwbh-cards", 2);
          open.onsuccess = () => {
            const db = open.result;
            if (!db.objectStoreNames.contains("pack-state")) return resolve(null);
            const req = db.transaction("pack-state").objectStore("pack-state").get("today");
            req.onsuccess = () => resolve((req.result as PackState) ?? null);
            req.onerror = () => resolve(null);
          };
          open.onerror = () => resolve(null);
        }),
    );
  }

  const sealedPack = (page: import("@playwright/test").Page) =>
    page.getByRole("button", { name: /tear the pack open/i });

  /** The card currently on the reveal stand. */
  const standCard = (page: import("@playwright/test").Page) =>
    page.locator('[role="button"][aria-pressed]').first();

  /** Where the perforation runs, as a fraction of the pack's height. */
  const TEAR_LINE = 0.15;

  test("a tap on the pack does not open it", async ({ page }) => {
    await page.goto("/players/pack");

    const pack = sealedPack(page);
    await expect(pack).toBeVisible();

    // The handler this replaced compared the pointer's absolute Y against the
    // pack's own top edge, so a press below 55% of its height opened the pack
    // having travelled nowhere. Progress is measured as travel now, and a tap
    // travels nothing.
    const box = (await pack.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.7);
    await expect(pack).toBeVisible();
  });

  test("a drag that stops short springs shut", async ({ page }) => {
    await page.goto("/players/pack");

    const pack = sealedPack(page);
    const box = (await pack.boundingBox())!;
    // A full rip is 80% of the pack's width and commits at 60% of that, so a
    // third of the way across is a rip somebody thought better of.
    await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * TEAR_LINE);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * TEAR_LINE, { steps: 8 });
    await page.mouse.up();

    await expect(pack).toBeVisible();
  });

  test("a rip across the top tears the pack open", async ({ page }) => {
    await page.goto("/players/pack");

    const pack = sealedPack(page);
    await expect(pack).toBeVisible();

    // Horizontal travel along the perforation, left to right, the way you would
    // actually rip foil.
    const box = (await pack.boundingBox())!;
    expect(box).toBeTruthy();
    await page.mouse.move(box.x + box.width * 0.08, box.y + box.height * TEAR_LINE);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.95, box.y + box.height * TEAR_LINE, { steps: 12 });
    await page.mouse.up();

    // The sealed wrapper is gone once it has been torn.
    await expect(pack).toBeHidden();
  });

  test("plays the opening ceremony, and lets you cut it short", async ({ page }) => {
    await page.goto("/players/pack");
    await sealedPack(page).press("Enter");

    // The pack stops being a control the instant the rip commits — which is what
    // every other test here relies on to mean "opened" — while the ceremony that
    // follows it is still on screen.
    await expect(sealedPack(page)).toBeHidden();
    const skip = page.getByRole("button", { name: /^skip$/i });
    await expect(skip).toBeVisible();

    // The cards leaving the pack are decoration and are hidden from the tree, so
    // they are found by test id rather than by role.
    await expect(page.locator('[data-testid="opening-card"]')).toHaveCount(PACK_SIZE);

    await skip.click();
    await expect(page.getByText(/card 1 of 3/i)).toBeVisible();
    await expect(skip).toBeHidden();
  });

  test("gets to the stand on its own if the ceremony is left to finish", async ({ page }) => {
    await page.goto("/players/pack");
    await sealedPack(page).press("Enter");
    await expect(page.getByText(/card 1 of 3/i)).toBeVisible();
    // And the card it hands over is face-down, so the flip is still to come.
    await expect(page.getByText(/tap the card to turn it/i)).toBeVisible();
  });

  test("resumes on the card you were looking at, not the one after it", async ({ page }) => {
    await page.goto("/players/pack");
    await sealedPack(page).press("Enter");

    // Turn the first card over and stop there, the way you would to read it.
    await expect(page.getByText(/card 1 of 3/i)).toBeVisible();
    await standCard(page).click();
    await expect(page.getByTestId("pack-advance")).toBeVisible();

    await page.reload();

    // `revealed` alone cannot tell "looking at a card I just turned" from
    // "finished with it", so resuming from it dropped you on card 2 and card 1
    // was simply gone. The stored cursor is what distinguishes them.
    await expect(page.getByText(/card 1 of 3/i)).toBeVisible();
    await expect(page.getByTestId("pack-advance")).toBeVisible();
  });

  test("counts a card once however many times it is tapped mid-ceremony", async ({ page }) => {
    await page.goto("/players/pack");
    await sealedPack(page).press("Enter");

    // Walk to the last card, which is the one that holds before it turns.
    for (const n of [1, 2]) {
      await expect(page.getByText(new RegExp(`card ${n} of 3`, "i"))).toBeVisible();
      await standCard(page).click();
      await page.getByTestId("pack-advance").click();
    }
    await expect(page.getByText(/card 3 of 3/i)).toBeVisible();

    // It stays face-down and tappable for the whole 900ms hold. Every tap in
    // that window used to start another ceremony over the same card.
    const card = standCard(page);
    await card.click();
    await card.click({ force: true });
    await card.click({ force: true });

    await expect(page.getByTestId("pack-advance")).toBeVisible({ timeout: 15_000 });
    // Long enough for a second and third 900ms hold to have finished too. The
    // first ceremony completing is what makes the button appear, so reading
    // straight away would sample the row before any duplicate could land in it.
    await page.waitForTimeout(3_000);

    const state = (await readPackState(page))!;
    expect(state.revealed).toEqual([...new Set(state.revealed)]);
    expect(state.revealed).toHaveLength(PACK_SIZE);
  });

  test("reveal all turns every card face-down first, so none of them skip the flip", async ({
    page,
  }) => {
    await page.goto("/players/pack");
    await sealedPack(page).press("Enter");

    // A MutationObserver sees every intermediate render, which is what makes
    // this deterministic — the face-down beat is only ~300ms and polling would
    // race it. The stand's helper line is the tell: it reads "tap the card to
    // turn it" only while the card on it has not been turned.
    await page.evaluate(() => {
      const seen = new Set<string>();
      (window as unknown as { __faceDown: Set<string> }).__faceDown = seen;
      const sample = () => {
        const text = document.body.textContent ?? "";
        const at = text.match(/Card (\d) of 3/i);
        if (at && /tap the card to turn it/i.test(text)) seen.add(at[1]);
      };
      sample();
      new MutationObserver(sample).observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
      });
    });

    await page.getByRole("button", { name: /reveal all/i }).click();

    // The run drives the stand rather than skipping it, so it ends past the last
    // slot with the finished pack on screen.
    await expect(page.getByText(/pack complete/i)).toBeVisible({ timeout: 30_000 });

    // Every card was on the stand face-down before it turned. Without the beat,
    // the cursor move and the reveal batch into one render and cards 2 and 3
    // mount already face-up — the flip, the whole point of the stand, never
    // happens for them.
    const faceDown = await page.evaluate(() =>
      [...(window as unknown as { __faceDown: Set<string> }).__faceDown].sort(),
    );
    expect(faceDown).toEqual(["1", "2", "3"]);

    const state = (await readPackState(page))!;
    expect(state.revealed.slice().sort()).toEqual([0, 1, 2]);
  });

  test("deals a full pack of real roster cards and resumes it after a reload", async ({ page }) => {
    await page.goto("/players/pack");
    await expect(sealedPack(page)).toBeVisible();
    // Nothing is dealt until the pack is actually opened.
    expect(await readPackState(page)).toBeNull();

    // Keyboard rather than the drag: this test is about what gets persisted, and
    // the pack exposes Enter for exactly this. The gesture has its own test above,
    // so a broken drag fails there instead of silently hollowing this one out.
    await sealedPack(page).press("Enter");
    await expect(sealedPack(page)).toBeHidden();

    // The row is written from an effect, so give it a beat to land — but it must
    // land. A null here means the pack was never persisted, which is the whole
    // thing this test exists to catch.
    await expect.poll(() => readPackState(page)).not.toBeNull();

    const state = (await readPackState(page))!;
    // Exactly three, always. The daily secret is appended as a fourth slot on
    // screen but is never a roster id and never enters this row — its ownership
    // is a Postgres row keyed on the claimed member. This doubles as the
    // regression guard for that.
    expect(state.ids).toHaveLength(PACK_SIZE);
    // Every dealt card is a real roster entry, never a stale or invented id.
    expect(new Set(state.ids).size).toBe(PACK_SIZE);
    for (const id of state.ids) {
      expect(PLAYERS.map((p) => p.ep)).toContain(id);
    }

    // A return visit the same day resumes rather than re-dealing.
    await page.reload();
    await expect(sealedPack(page)).toBeHidden();
    expect((await readPackState(page))?.ids).toEqual(state.ids);
  });

  /** Deal a pack on a fresh page carrying the given localStorage, and read it back. */
  async function packFor(
    browser: import("@playwright/test").Browser,
    storage: Record<string, string>,
  ) {
    // A page from browser.newPage() has no baseURL of its own, so the path is
    // resolved against the config's here rather than against page.url() — which
    // is "about:blank" until something navigates.
    const other = await browser.newPage({ baseURL: BASE_URL });
    try {
      await stubServerFns(other);
      await other.addInitScript((entries: [string, string][]) => {
        for (const [k, v] of entries) localStorage.setItem(k, v);
      }, Object.entries(storage));
      await other.goto("/players/pack");
      await sealedPack(other).press("Enter");
      await expect.poll(() => readPackState(other)).not.toBeNull();
      return (await readPackState(other))!.ids;
    } finally {
      await other.close();
    }
  }

  const memberToken = (pid: string) => `m.${pid}.${Date.now() + 60 * 60_000}.signature`;

  /** The device-local date key, exactly as players.pack.tsx builds it. */
  function dayKey(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  /** What this identity should be dealt today. Nothing collected on a fresh page. */
  const expectedPack = (identity: string) =>
    dealPack(BUNDLE.participants, packSeed(EVENT_ID, dayKey(), identity), {}, PACK_SIZE).map(
      (p) => p.id,
    );

  test("deals one person the same three cards on either of their phones", async ({ browser }) => {
    // Packs are per *person* now, not per device — so a member picking up a
    // second handset gets the pack they already had rather than a new one. This
    // is the load-bearing assertion: it proves the member id, and not the device
    // id, is what seeds a claimed pack.
    const token = memberToken("p-alice");
    const first = await packFor(browser, {
      "wwbh:member-token": token,
      "wwbh:member-name": "Alice Ace",
      "wwbh:device-id": "device-one",
    });
    const second = await packFor(browser, {
      "wwbh:member-token": token,
      "wwbh:member-name": "Alice Ace",
      "wwbh:device-id": "device-two",
    });
    expect(first).toHaveLength(PACK_SIZE);
    expect(second).toEqual(first);
    // And it is specifically the pack this member earns — not just any two packs
    // that happen to agree.
    expect(first).toEqual(expectedPack("m:p-alice"));
  });

  test("deals each person the pack their own name earns", async ({ browser }) => {
    // The whole point of the change: the seed carries who you are. Two members on
    // the same device, same day, each getting the pack computed for *them* is the
    // end-to-end proof of that wiring.
    const alice = await packFor(browser, {
      "wwbh:member-token": memberToken("p-alice"),
      "wwbh:member-name": "Alice Ace",
      "wwbh:device-id": "device-one",
    });
    const bob = await packFor(browser, {
      "wwbh:member-token": memberToken("p-bob"),
      "wwbh:member-name": "Bob Blitz",
      "wwbh:device-id": "device-one",
    });
    expect(alice).toEqual(expectedPack("m:p-alice"));
    expect(bob).toEqual(expectedPack("m:p-bob"));
  });

  test("gives two unclaimed phones two different packs", async ({ browser }) => {
    // A guest has no person behind them, so the device stands in — and they must
    // still get three cards, because nothing here is allowed to gate the pack.
    //
    // The two device ids are *searched for* rather than pinned: the fixture
    // roster is four players deep, so an arbitrary pair collides some days and
    // not others. Picking a pair that genuinely differs today is what makes this
    // a real assertion every day rather than a lucky one.
    const ids = Array.from({ length: 40 }, (_, i) => `guest-${i}`);
    const first = ids[0];
    const second = ids.slice(1).find((d) => expectedPack(`d:${d}`).join() !== expectedPack(`d:${first}`).join()); // prettier-ignore
    expect(second, "no two guest device ids produced different packs").toBeTruthy();

    const one = await packFor(browser, { "wwbh:device-id": first });
    const two = await packFor(browser, { "wwbh:device-id": second! });
    expect(one).toEqual(expectedPack(`d:${first}`));
    expect(two).toEqual(expectedPack(`d:${second}`));
    expect(two).not.toEqual(one);
  });
});

test.describe("navigation", () => {
  test("the nav reaches the main pages", async ({ page }) => {
    await page.goto("/");
    for (const [name, url] of [
      [/live/i, /\/live/],
      [/leaderboard/i, /\/leaderboard/],
    ] as const) {
      const link = page.getByRole("link", { name }).first();
      if (await link.isVisible().catch(() => false)) {
        await link.click();
        await expect(page).toHaveURL(url);
        await page.goto("/");
      }
    }
  });
});
