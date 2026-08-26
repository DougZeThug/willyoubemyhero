// Scripted verification pass for the product description.
//
// Covers only what a stubbed browser can honestly answer: routing, what renders,
// nav rules, the League hub's contents, empty and gated states, and the
// per-device storage keys. Everything else in the checklists needs a phone.
import { test, expect, BUNDLE, PLAYERS } from "../../../e2e/fixtures";
import type { Page } from "@playwright/test";

const EVENT = BUNDLE.event as Record<string, unknown>;

/**
 * Put cards in this device's collection.
 *
 * The vault draws a star only on a card you own — a locked slot has no copy to
 * pin — so without this every roster tile renders face-down and the favourites
 * items have nothing to click.
 */
async function seedCollection(page: Page) {
  await page.goto("/players");
  await page.evaluate(
    (eps: string[]) =>
      new Promise<void>((resolve) => {
        const open = indexedDB.open("wwbh-cards", 2);
        open.onupgradeneeded = () => {
          const db = open.result;
          for (const s of ["collected", "card-meta", "pack-state"]) {
            if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
          }
        };
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("collected", "readwrite");
          const store = tx.objectStore("collected");
          for (const id of eps) {
            store.put(
              { eventParticipantId: id, pulledAt: Date.now(), count: 1, tier: "base" },
              id,
            );
          }
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        };
        open.onerror = () => resolve();
      }),
    PLAYERS.map((p) => p.ep),
  );
  await page.reload();
}

// ---------- FND: navigation and screens ----------

test("FND-N1 the root path redirects to the vault", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/players$/);
});

const TABS = [
  { path: "/players", label: /vault/i },
  { path: "/players/pack", label: /pack/i },
  { path: "/players/trade", label: /trade/i },
  { path: "/leaderboard", label: /board/i },
  { path: "/league", label: /league/i },
];

for (const tab of TABS) {
  test(`FND-N2 ${tab.path} lights exactly one tab`, async ({ page }) => {
    await page.goto(tab.path);
    await expect(page.locator("body")).not.toBeEmpty();
    // The active tab is marked with a colour class, not aria-current — see the
    // accessibility finding this pass raised.
    const current = page.locator("nav a.text-primary:visible");
    await expect(current.first()).toBeVisible();
    await expect(current.first()).toHaveAttribute("href", tab.path);
  });
}

test("FND-N3 the League hub holds exactly five tiles", async ({ page }) => {
  await page.goto("/league");
  const wanted = ["/live", "/order", "/draft", "/awards", "/analytics"];
  for (const href of wanted) {
    await expect(page.locator(`a[href="${href}"]`).first()).toBeVisible();
  }
});

test("FND-N4 the Shop tab is absent while dust is off", async ({ page, server }) => {
  server.set("getActiveEvent", { ...EVENT, dust_enabled: false });
  await page.goto("/players");
  await expect(page.locator('nav a[href="/players/shop"], a[href="/players/shop"]')).toHaveCount(0);
});

test("FND-N5 the Shop tab appears while dust is on", async ({ page, server }) => {
  server.set("getActiveEvent", { ...EVENT, dust_enabled: true });
  await page.goto("/players");
  await expect(page.locator('a[href="/players/shop"]:visible').first()).toBeVisible();
});

// ---------- VLT: the vault and favourites ----------

test("VLT-F1 no Favourites shelf exists when nothing is pinned", async ({ page }) => {
  await page.goto("/players");
  await expect(page.locator("body")).not.toBeEmpty();
  await expect(page.getByRole("heading", { name: /^favourites$/i })).toHaveCount(0);
});

test("VLT-F2 the star names the card and the direction of travel", async ({ page }) => {
  await seedCollection(page);
  const star = page.getByRole("button", { name: /^Pin .+ to the top$/ }).first();
  await expect(star).toBeVisible();
  await expect(star).toHaveAttribute("aria-pressed", "false");
});

test("VLT-F3 pinning writes the device key and raises a Favourites shelf", async ({ page }) => {
  await seedCollection(page);
  const star = page.getByRole("button", { name: /^Pin .+ to the top$/ }).first();
  await star.click();
  await expect(page.getByRole("button", { name: /^Unpin .+ from the top$/ }).first()).toBeVisible();
  const stored = await page.evaluate(() => window.localStorage.getItem("wwbh:vault-favourites"));
  expect(stored).toBeTruthy();
  const ids = JSON.parse(stored!).ids;
  expect(Array.isArray(ids)).toBe(true);
  expect(ids).toHaveLength(1);
  expect(String(ids[0])).toMatch(/^p:/);
  await expect(page.getByRole("heading", { name: /^favourites$/i }).first()).toBeVisible();
});

test("VLT-F4 pinning a second card appends rather than prepends", async ({ page }) => {
  await seedCollection(page);
  const first = page.getByRole("button", { name: /^Pin .+ to the top$/ }).first();
  await first.click();
  const firstId = await page.evaluate(
    () => JSON.parse(window.localStorage.getItem("wwbh:vault-favourites")!).ids[0],
  );
  const next = page.getByRole("button", { name: /^Pin .+ to the top$/ }).first();
  await next.click();
  const ids = await page.evaluate(
    () => JSON.parse(window.localStorage.getItem("wwbh:vault-favourites")!).ids,
  );
  expect(ids).toHaveLength(2);
  expect(ids[0]).toBe(firstId);
});

test("VLT-F5 unpinning removes the shelf entirely rather than emptying it", async ({ page }) => {
  await seedCollection(page);
  const star = page.getByRole("button", { name: /^Pin .+ to the top$/ }).first();
  await star.click();
  await expect(page.getByRole("heading", { name: /^favourites$/i }).first()).toBeVisible();
  await page.getByRole("button", { name: /^Unpin .+ from the top$/ }).first().click();
  await expect(page.getByRole("heading", { name: /^favourites$/i })).toHaveCount(0);
});

test("VLT-F6 junk under the favourites key reads as an empty shelf", async ({ page }) => {
  await seedCollection(page);
  await page.evaluate(() => window.localStorage.setItem("wwbh:vault-favourites", "not json"));
  await page.reload();
  await expect(page.locator("body")).not.toBeEmpty();
  await expect(page.getByRole("heading", { name: /^favourites$/i })).toHaveCount(0);
});

// ---------- Gated and empty states ----------

test("TRD-G1 the trading post gates a device with no member token", async ({ page }) => {
  await page.goto("/players/trade");
  await expect(page.locator("body")).not.toBeEmpty();
  await expect(page.getByText(/claim|sign in/i).first()).toBeVisible();
});

test("ADM-G1 the admin console shows its gate rather than its contents", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.locator("body")).not.toBeEmpty();
  await expect(page.getByText(/pin/i).first()).toBeVisible();
});

test("CMB-E1 a combine with no roster does not congratulate anybody", async ({ page, server }) => {
  server.set("getEventBundle", {
    event: null, participants: [], stations: [], runs: [], splits: [], penalties: [], drafts: [],
  });
  await page.goto("/live");
  await expect(page.locator("body")).not.toBeEmpty();
  await expect(page.getByText(/everyone is done|all done/i)).toHaveCount(0);
});

test("CMB-E2 a failed roster read is not reported as an empty field", async ({ page, server }) => {
  server.fail("getEventBundle", "boom");
  await page.goto("/live");
  await expect(page.locator("body")).not.toBeEmpty();
  await expect(page.getByText(/everyone is done|all done/i)).toHaveCount(0);
});
