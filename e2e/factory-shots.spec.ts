// Before/after screenshots for the software factory's polish runs.
//
// NOT a test of behaviour. It is skipped unless FACTORY_SHOTS is set, so the CI
// e2e job reports it as skipped and pays nothing for it. `.claude/factory/shots.mjs`
// runs it twice, once on the base commit ("before") and once on the branch
// ("after"), and lays the two sets side by side.
//
// It goes through the same playwright.config.ts as every other spec on purpose:
// that config points every Supabase variable at a dead local address, and server
// functions are stubbed in the browser (fixtures.ts), so a capture cannot reach
// the live project. Do not give this its own config.
//
// One browser context per capture, and the full-page shot taken last in it:
// Chromium drops the mobile device-metrics override after a fullPage screenshot,
// which would make every later control render at its desktop size.
import fs from "node:fs";
import path from "node:path";
import { devices, type Page } from "@playwright/test";
import { expect, stubServerFns, test, type ServerFnMock } from "./fixtures";

const LABEL = process.env.FACTORY_SHOTS ?? "";
const OUT = process.env.FACTORY_SHOT_DIR ?? "";
const ONLY = (process.env.FACTORY_SHOT_SCENES ?? "").split(",").filter(Boolean);
const ONLY_VIEWPORTS = (process.env.FACTORY_SHOT_VIEWPORTS ?? "").split(",").filter(Boolean);

// Phone widths from the audit's own set, plus one desktop.
const VIEWPORTS = [
  { name: "320", width: 320, height: 844, phone: true },
  { name: "390", width: 390, height: 844, phone: true },
  { name: "430", width: 430, height: 932, phone: true },
  { name: "desktop", width: 1280, height: 800, phone: false },
];

const MEMBER_KEY = "wwbh:member-token";

const OWNS = {
  cards: [
    { eventParticipantId: "ep-alice", pullCount: 2, edition: "gold", firstPulledAt: "2026-07-28T10:00:00Z" }, // prettier-ignore
    { eventParticipantId: "ep-bob", pullCount: 1, edition: "standard", firstPulledAt: "2026-07-28T10:00:00Z" }, // prettier-ignore
    { eventParticipantId: "ep-carol", pullCount: 1, edition: "silver", firstPulledAt: "2026-07-29T10:00:00Z" }, // prettier-ignore
  ],
  packsOpened: 2,
  firstPackOn: "2026-07-28",
};

async function asMember(page: Page) {
  await page.addInitScript(
    ([key, token]) => {
      localStorage.setItem(key, token);
      localStorage.setItem("wwbh:member-name", "Alice Ace");
    },
    [MEMBER_KEY, `m.p-alice.${Date.now() + 60 * 60_000}.signature`] as const,
  );
}

/**
 * Open the sort sheet. The page is server-rendered, so the Roster heading is on
 * screen before React hydrates; a click in that gap is silently lost. Retrying
 * until the sheet is actually there is steadier than guessing a delay.
 */
async function openSortSheet(page: Page) {
  await expect(async () => {
    await page.getByRole("button", { name: "Sort and filter the roster" }).click();
    await expect(page.getByText("Card size").first()).toBeVisible({ timeout: 1_500 });
  }).toPass({ timeout: 15_000 });
}

type Scene = {
  name: string;
  /** Stub the data this scene needs, before the first navigation. */
  arrange?: (server: ServerFnMock) => void;
  /** Drive the page into the state to photograph, after it has loaded. */
  act?: (page: Page, server: ServerFnMock) => Promise<void>;
};

const SCENES: Scene[] = [
  { name: "vault" },
  {
    name: "vault-sort-sheet",
    act: async (page) => {
      await openSortSheet(page);
    },
  },
  {
    name: "vault-rearranging",
    act: async (page) => {
      await openSortSheet(page);
      await page.getByRole("button", { name: "Rearrange shelves" }).click();
      // The sheet closes itself; wait for the rearrange arrows to appear.
      await page
        .getByRole("button", { name: /move .* down/i })
        .first()
        .waitFor();
    },
  },
  {
    name: "vault-secrets-error",
    arrange: (server) => server.fail("getMySecrets", "capture: simulated outage"),
    // The query retries (3 times, with backoff) before it reports an error, and the
    // panel only exists once it has. Wait for the fourth failed call rather than
    // for a time: photographing earlier captures a loading screen in both trees.
    act: async (page, server) => {
      await expect(page.getByRole("link", { name: /^Alice Ace/ })).toBeVisible({ timeout: 40_000 });
      await expect
        .poll(() => server.calls.filter((call) => call.includes("getMySecrets")).length, {
          timeout: 40_000,
        })
        .toBeGreaterThanOrEqual(4);
      await page.waitForTimeout(800); // let React render the settled error
    },
  },
];

test.describe("factory screenshots", () => {
  test.skip(
    !LABEL || !OUT,
    "set FACTORY_SHOTS and FACTORY_SHOT_DIR (see .claude/factory/shots.mjs)",
  );

  for (const scene of SCENES.filter((s) => !ONLY.length || ONLY.includes(s.name))) {
    for (const vp of VIEWPORTS.filter(
      (v) => !ONLY_VIEWPORTS.length || ONLY_VIEWPORTS.includes(v.name),
    )) {
      // prettier-ignore
      test(`${scene.name} @ ${vp.name}`, async ({ browser }) => {
        // A scene that cannot reach its state should fail fast.
        test.setTimeout(60_000);
        const context = await browser.newContext(
          vp.phone
            ? { ...devices["iPhone 13"], viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, reducedMotion: "reduce" } // prettier-ignore
            : { viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, reducedMotion: "reduce" },
        );
        const page = await context.newPage();
        // The capture's backend is deliberately dead, so the realtime channel never
        // connects and "Live feed down" pops in at an arbitrary moment, shifting the
        // layout between two otherwise identical renders. It says nothing about the
        // change under review, so keep it out of both trees' frames (compare.md says so).
        await page.addInitScript(() => {
          const hide = () => {
            for (const el of document.querySelectorAll<HTMLElement>("div")) {
              const text = el.textContent ?? "";
              if (text.length < 80 && text.includes("Live feed down")) el.style.display = "none";
            }
          };
          new MutationObserver(hide).observe(document, { childList: true, subtree: true });
        });
        const server = await stubServerFns(page);
        await asMember(page);
        server.set("getMyCardStats", OWNS);
        scene.arrange?.(server);
        await page.goto("/players");
        await expect(page.getByRole("heading", { name: "Roster" })).toBeVisible();
        // The heading is server-rendered, so it proves nothing about data. Photographing
        // on it alone caught a skeleton in one tree and a loaded page in the other.
        await expect(page.getByRole("link", { name: /^Alice Ace/ })).toBeVisible({ timeout: 40_000 });
        // Shorter than the test timeout, so a failing step throws while the page is
        // still alive and the catch below can photograph it.
        page.setDefaultTimeout(10_000);
        try {
          await scene.act?.(page, server);
        } catch (error) {
          // Playwright only screenshots its own default page on failure, which here
          // is blank. Keep the frame from the context that actually failed.
          fs.mkdirSync(path.join(OUT, LABEL), { recursive: true });
          await page.screenshot({ path: path.join(OUT, LABEL, `FAILED-${scene.name}-${vp.name}.png`) }); // prettier-ignore
          throw error;
        }
        // Let entrance animations and image decodes settle; a half-faded frame
        // would read as a layout difference between before and after.
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(600);

        // Whether the real display face rendered. A fallback face is narrower, so
        // every width in the capture would be a little wrong — say so in the data.
        const fontOk = await page.evaluate(() => document.fonts.check('700 16px "Barlow Condensed"'));

        const dir = path.join(OUT, LABEL);
        fs.mkdirSync(dir, { recursive: true });
        // Frozen motion, so two renders of an unchanged screen match pixel for pixel and
        // a byte comparison between before and after means something.
        await page.screenshot({ path: path.join(dir, `${scene.name}-${vp.name}.png`), animations: "disabled" });
        // Last in this context — see the header.
        await page.screenshot({
          path: path.join(dir, `${scene.name}-${vp.name}-full.png`),
          fullPage: true,
          animations: "disabled",
        });
        const metaPath = path.join(dir, "meta.json");
        const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, "utf8")) : {};
        meta[`${scene.name}-${vp.name}`] = { fontOk };
        fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
        await context.close();
      });
    }
  }
});
