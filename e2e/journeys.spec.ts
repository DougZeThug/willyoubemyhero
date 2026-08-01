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

  test("asks a signed-out visitor for a name before reacting", async ({ page }) => {
    // This used to assert a "Claim your player" link, and went stale when the
    // members-only gate on reactions was replaced by an anonymous guest identity:
    // a signed-out visitor can react and talk trash, they just have to say what
    // to call them first. Asserting the old copy was asserting a wall the product
    // deliberately pulled down.
    await page.goto("/players/ep-alice");
    // Matched on the label prefix rather than the emoji, which is brittle inside
    // an accessible-name filter.
    await page
      .getByRole("button", { name: /^React with/ })
      .first()
      .click();
    await expect(page.getByText(/what should we call you/i)).toBeVisible();
  });
});

test.describe("opening a pack", () => {
  const PACK_SIZE = 3;

  /** Today's pack row straight out of IndexedDB, or null if nothing is stored. */
  type PackState = { dayKey: string; ids: string[]; revealed: number[] };

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
    page.getByRole("button", { name: /drag down to open the pack/i });

  test("a drag past the threshold tears the pack open", async ({ page }) => {
    await page.goto("/players/pack");

    const pack = sealedPack(page);
    await expect(pack).toBeVisible();

    // The handler tears at 55% of the element's own height, measured from its
    // top edge — so the drag has to start high on the pack and finish low.
    const box = (await pack.boundingBox())!;
    expect(box).toBeTruthy();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.1);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.95, { steps: 12 });
    await page.mouse.up();

    // The sealed wrapper is gone once it has been torn.
    await expect(pack).toBeHidden();
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
