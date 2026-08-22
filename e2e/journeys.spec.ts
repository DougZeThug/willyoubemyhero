// The flows that matter: getting in, seeing results, and opening a pack.
import {
  test,
  expect,
  BUNDLE,
  EVENT_ID,
  PLAYERS,
  sealedPack,
  stubServerFns,
  tearPack,
} from "./fixtures";
// The same pure functions the pack route deals from, so these tests can compute
// the pack they expect rather than guess at one. With a four-player fixture and
// a three-card pack, "assert two packs differ" collides often enough to be flaky;
// "assert this pack is the one this identity earns" never does.
import { dealPack, packSeed } from "../src/lib/pack";
import { editionLabel, editionSeed, rollEdition } from "../src/lib/card-edition";
import { CEREMONY_MS } from "../src/lib/pack-ceremony";

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

  test("keeps every card face-down until it has been packed", async ({ page }) => {
    // A fresh browser context has an empty IndexedDB and no member session, so
    // nothing is collected and the whole set starts shut. The names stay
    // readable — the slot says which card it is hiding, just not what is on it.
    await page.goto("/players");
    await expect(page.getByText(/not packed yet/i)).toHaveCount(PLAYERS.length);
  });

  /**
   * Times reversed against the default fixture, so tier order and name order
   * disagree. Carol owns the fastest run here and would lead a rarity sort,
   * while alphabetically she is third — which is the whole point: on the default
   * bundle the champion is also first alphabetically, and a sort that leaked
   * every tier would produce the same order as one that leaked none.
   */
  const TIMES: Record<string, number> = {
    "p-alice": 70_000,
    "p-bob": 60_000,
    "p-carol": 50_000,
  };
  const TIERS_AGAINST_NAMES = {
    ...BUNDLE,
    runs: BUNDLE.runs.map((r) => ({
      ...r,
      official_time_ms: TIMES[r.participant_id],
      raw_time_ms: TIMES[r.participant_id],
    })),
  };

  test("does not let the rarity sort name the cards it is hiding", async ({ page, server }) => {
    server.set("getEventBundle", TIERS_AGAINST_NAMES);
    // A member, so readiness genuinely waits on the server — and held there, so
    // the reconciling window is wide enough to read rather than a frame to race.
    // This is the window the leak lived in: every card is face-down, and a sort
    // that asked for their real ranks anyway put the champion first under a grid
    // of identical backs until the answer landed.
    await page.addInitScript(
      ([key, token]) => {
        localStorage.setItem(key, token);
        localStorage.setItem("wwbh:member-name", "Alice Ace");
      },
      [MEMBER_KEY, `m.p-alice.${Date.now() + 60 * 60_000}.signature`] as const,
    );
    server.set("getMyCardStats", { cards: [], packsOpened: 0, firstPackOn: null });
    server.delay("getMyCardStats", 20_000);

    await page.goto("/players");

    // Wait for the grid before touching the sort. The buttons ship in the SSR
    // html and the roster does not, so a click any earlier lands on an
    // unhydrated button, does nothing, and leaves the grid in its default name
    // order — which is the order this test asserts. It would have passed against
    // the leak it exists to catch.
    const slots = page.locator('[role="img"][aria-label$="not packed yet"]');
    await expect(slots).toHaveCount(PLAYERS.length);
    await page.getByRole("button", { name: /^rarity$/i }).click();

    // Every slot is face-down, so every slot shares the sentinel rank and the
    // name tie-break is the only thing left ordering them. Carol first would
    // mean the grid had just announced its champion.
    const names = await slots.evaluateAll((els) =>
      els.map((el) => (el.getAttribute("aria-label") ?? "").split(" — ")[0]),
    );
    expect(names).toEqual(PLAYERS.map((p) => p.name));
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

  /** The card currently on the reveal stand. */
  const standCard = (page: import("@playwright/test").Page) =>
    page.locator('[role="button"][aria-pressed]').first();

  /**
   * Which step the stand is on, and therefore that the stand has the screen.
   *
   * Read off a test id rather than matched out of the page's prose: this line is
   * deliberately faint presentation copy and has been reworded once already,
   * which silently broke five specs at once.
   */
  const standStep = (page: import("@playwright/test").Page) => page.getByTestId("stand-step");

  /** The line that says the card on the stand is revealed and swiping steps on. */
  const swipeHint = (page: import("@playwright/test").Page) =>
    page.getByText(/swipe for the next card/i);

  /**
   * Step to the next card the way a thumb does: a fast leftward throw across
   * the revealed card. There is no Next button — the stand reads the gesture
   * with swipeDirection() from src/lib/zoom.ts, which wants ≥48px of mostly
   * horizontal travel inside 700ms.
   */
  async function swipeNext(page: import("@playwright/test").Page) {
    const box = (await standCard(page).boundingBox())!;
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width * 0.85, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.15, y, { steps: 4 });
    await page.mouse.up();
  }

  /** Where the perforation runs, as a fraction of the pack's height. */
  const TEAR_LINE = 0.15;

  /**
   * When to press Skip.
   *
   * Past the ceremony's own 140ms dead zone — a click inside it is deliberately
   * ignored, and would leave the test waiting out the full sequence and failing
   * for the wrong reason — and with most of the ceremony still to run, so the
   * elapsed-time assertion has real headroom.
   */
  const SKIP_AFTER_MS = 300;

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

  test("plays the opening ceremony over the torn pack", async ({ page }) => {
    await page.goto("/players/pack");
    await tearPack(page);

    // The pack stops being a control the instant the rip commits — which is what
    // every other test here relies on to mean "opened" — while the ceremony that
    // follows it is still on screen.
    await expect(sealedPack(page)).toBeHidden();
    await expect(page.getByRole("button", { name: /^skip$/i })).toBeVisible();

    // The cards leaving the pack are decoration and are hidden from the tree, so
    // they are found by test id rather than by role. One per card actually dealt.
    await expect(page.locator('[data-testid="opening-card"]')).toHaveCount(PACK_SIZE);
  });

  test("skip cuts the ceremony short rather than waiting it out", async ({ page }) => {
    // The ceremony runs on setTimeout and reads performance.now() for its skip
    // dead zone, so a fake clock owns both. Wall-clock timing here used to be the
    // assertion, and it flaked: the budget included Playwright's own keypress and
    // click round-trips, which on a loaded runner can eat the whole 2.2s of slack
    // even when skipping worked perfectly.
    await page.clock.install();
    await page.goto("/players/pack");
    // A faked clock does not tick on its own, and hydration, query settling and
    // motion all wait on timers, so the page needs time handed to it before it is
    // a pack at all.
    await page.clock.runFor(2000);
    await expect(sealedPack(page)).toBeVisible();

    // The pack refuses to tear until the collection has reconciled, and under a
    // clock the test owns that beat can land after the first keypress. Press
    // until it takes, handing the page a little time on each attempt.
    const skip = page.getByRole("button", { name: /^skip$/i });
    await expect(async () => {
      if (await sealedPack(page).isVisible()) await sealedPack(page).press("Enter");
      await page.clock.runFor(100);
      expect(await skip.isVisible()).toBe(true);
    }).toPass({ timeout: 20_000 });

    // Past the dead zone that stops the pointerup ending a drag-rip from also
    // eating the ceremony, and far short of the ~2.2s the sequence would take on
    // its own.
    await page.clock.runFor(SKIP_AFTER_MS);
    await skip.click();
    await expect(standStep(page)).toHaveText("1 / 3");

    // What makes this a test of *skipping*: the page's clock has only advanced
    // SKIP_AFTER_MS of the ceremony's CEREMONY_MS, so its own handover timer
    // cannot have fired. Reaching the stand can only be the button's doing.
    expect(SKIP_AFTER_MS).toBeLessThan(CEREMONY_MS);
  });

  test("gets to the stand on its own if the ceremony is left to finish", async ({ page }) => {
    await page.goto("/players/pack");
    await tearPack(page);
    await expect(standStep(page)).toHaveText("1 / 3");
    // And the card it hands over is face-down, so the flip is still to come.
    await expect(page.getByText(/tap the card to turn it/i)).toBeVisible();
  });

  test("resumes on the card you were looking at, not the one after it", async ({ page }) => {
    await page.goto("/players/pack");
    await tearPack(page);

    // Turn the first card over and stop there, the way you would to read it.
    await expect(standStep(page)).toHaveText("1 / 3");
    await standCard(page).click();
    await expect(swipeHint(page)).toBeVisible();

    await page.reload();

    // `revealed` alone cannot tell "looking at a card I just turned" from
    // "finished with it", so resuming from it dropped you on card 2 and card 1
    // was simply gone. The stored cursor is what distinguishes them.
    await expect(standStep(page)).toHaveText("1 / 3");
    await expect(swipeHint(page)).toBeVisible();
  });

  test("counts a card once however many times it is tapped mid-ceremony", async ({ page }) => {
    await page.goto("/players/pack");
    await tearPack(page);

    // Walk to the last card, which is the one that holds before it turns.
    for (const n of [1, 2]) {
      await expect(standStep(page)).toHaveText(`${n} / 3`);
      await standCard(page).click();
      await expect(swipeHint(page)).toBeVisible();
      await swipeNext(page);
    }
    await expect(standStep(page)).toHaveText("3 / 3");

    // It stays face-down and tappable for the whole 900ms hold. Every tap in
    // that window used to start another ceremony over the same card.
    const card = standCard(page);
    await card.click();
    await card.click({ force: true });
    await card.click({ force: true });

    await expect(swipeHint(page)).toBeVisible({ timeout: 15_000 });
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
    await tearPack(page);

    // A MutationObserver sees every intermediate render, which is what makes
    // this deterministic — the face-down beat is only ~300ms and polling would
    // race it. The stand's helper line is the tell: it reads "tap the card to
    // turn it" only while the card on it has not been turned.
    await page.evaluate(() => {
      const seen = new Set<string>();
      (window as unknown as { __faceDown: Set<string> }).__faceDown = seen;
      const sample = () => {
        const step = document.querySelector('[data-testid="stand-step"]')?.textContent ?? "";
        const at = step.match(/(\d)\s*\/\s*3/);
        const text = document.body.textContent ?? "";
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

  test("turns the cards it deals face-up in the vault, and only those", async ({ page }) => {
    await page.goto("/players/pack");
    await tearPack(page);

    // Reveal all rather than three swipes: this test is about what packing does
    // to the vault, and the stand's own gestures are covered above.
    await page.getByRole("button", { name: /reveal all/i }).click();
    await expect(page.getByText(/pack complete/i)).toBeVisible({ timeout: 30_000 });

    await page.goto("/players");
    // A pack is three distinct roster cards, so on a four-player fixture exactly
    // one slot is still shut — which is also what stops this passing on a page
    // that simply unlocked everything.
    await expect(page.getByText(/not packed yet/i)).toHaveCount(PLAYERS.length - PACK_SIZE);
  });

  test("takes the compare sheet with it when a card you have not packed comes up", async ({
    page,
  }) => {
    await page.goto("/players/pack");
    await tearPack(page);
    await page.getByRole("button", { name: /reveal all/i }).click();
    await expect(page.getByText(/pack complete/i)).toBeVisible({ timeout: 30_000 });

    // Which card the pack leaves out is whatever this identity's seed decides,
    // so it is read off the vault rather than assumed.
    await page.goto("/players");
    const shut = page.locator('[role="img"][aria-label$="not packed yet"]');
    await expect(shut).toHaveCount(PLAYERS.length - PACK_SIZE);
    const shutName = (await shut.first().getAttribute("aria-label"))!.split(" — ")[0];
    const tiles = await page
      .locator('a[href^="/players/ep-"]')
      .evaluateAll((els) =>
        els.map((e) => [e.getAttribute("href")!, e.textContent ?? ""] as const),
      );
    const packed = tiles.find(([, text]) => !text.includes(shutName))![0];
    const shutHref = tiles.find(([, text]) => text.includes(shutName))![0];

    await page.goto(packed);
    const compare = page.getByRole("button", { name: /^compare$/i });
    await expect(compare).toBeEnabled();
    await compare.click();
    const sheet = page.getByText(/pick someone to compare/i);
    await expect(sheet).toBeVisible();

    // The arrow keys move between cards without unmounting the page — and they
    // still reach it through the open sheet, which is what made this reachable:
    // the sheet's own overlay swallows a tap on the filmstrip, but not a keypress
    // on the window. Walk along until the card nobody packed comes up.
    for (let i = 0; i < PLAYERS.length && new URL(page.url()).pathname !== shutHref; i++) {
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(400);
    }
    expect(new URL(page.url()).pathname).toBe(shutHref);

    // Left open, the sheet would sit there fully interactive over a card whose
    // own Compare chip is greyed out underneath it.
    await expect(sheet).toBeHidden();
    await expect(compare).toBeDisabled();
  });

  test("deals a full pack of real roster cards and resumes it after a reload", async ({ page }) => {
    await page.goto("/players/pack");
    await expect(sealedPack(page)).toBeVisible();
    // Nothing is dealt until the pack is actually opened.
    expect(await readPackState(page)).toBeNull();

    // Keyboard rather than the drag: this test is about what gets persisted, and
    // the pack exposes Enter for exactly this. The gesture has its own test above,
    // so a broken drag fails there instead of silently hollowing this one out.
    await tearPack(page);
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
      await tearPack(other);
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

  test("prints the finish the pack actually rolled, and keeps it across a reload", async ({
    page,
  }) => {
    // Searched for rather than pinned, the same technique the guest-ids test
    // above uses and for a sharper reason: seven pulls in ten are standard and
    // print no badge at all, so an arbitrary device id would assert nothing most
    // days and then fail on the day it drew a gold.
    const withBadge = Array.from({ length: 200 }, (_, i) => `finish-${i}`)
      .map((device) => {
        const seed = packSeed(EVENT_ID, dayKey(), `d:${device}`);
        const ids = expectedPack(`d:${device}`);
        const at = ids.findIndex((id) => rollEdition(editionSeed(seed, id)) !== "standard");
        return { device, at, edition: at < 0 ? null : rollEdition(editionSeed(seed, ids[at])) };
      })
      .find((c) => c.at === 0);
    expect(withBadge, "no device id drew a non-standard first card today").toBeTruthy();
    const label = editionLabel(withBadge!.edition)!;

    await page.addInitScript((device: string) => {
      localStorage.setItem("wwbh:device-id", device);
    }, withBadge!.device);
    await page.goto("/players/pack");
    await tearPack(page);

    // Nothing before the turn: a badge on a face-down card spends the reveal.
    await expect(page.getByText(label, { exact: false })).toBeHidden();
    await standCard(page).click();
    await expect(page.getByText(label, { exact: false }).first()).toBeVisible();

    // The finish is derived, never stored — so a reload has to re-roll it to the
    // same answer rather than read it back.
    await page.reload();
    await expect(page.getByText(label, { exact: false }).first()).toBeVisible();
  });

  test("puts no finish on a card nobody has packed", async ({ page }) => {
    // The vault, where every slot is face-down until it is pulled. A frame on one
    // would give away the best thing about a card before the pack containing it
    // is torn — and unlike a tier, a finish is knowable from nowhere else.
    await page.goto("/players");
    await expect(page.getByRole("heading", { name: /the vault/i })).toBeVisible();
    await expect(page.locator(".card-edition")).toHaveCount(0);
    await expect(page.getByText(/Parallel/i)).toHaveCount(0);
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

/**
 * The whole sequence with the production switched off.
 *
 * Almost everything the pack does now branches on this preference — the opening
 * ceremony, the handoff onto the stand, the flip's light and punch, the rarity
 * ambience, the fake ending, the secret's flash and shake. Each of those is
 * guarded individually, which is exactly the shape of thing where one of them
 * quietly stops being guarded and nobody notices, because nobody develops with
 * the setting on.
 *
 * So this asserts the only thing that actually matters: with it on, the pack
 * still opens, the cards still turn, and it still finishes.
 */
test.describe("with reduced motion", () => {
  test("skips the production but still opens and finishes the pack", async ({ page }) => {
    // emulateMedia rather than `test.use({ reducedMotion })`: the suite's `test`
    // is an extended fixture whose option type does not carry Playwright's own
    // page options, so the declarative form does not typecheck even though it
    // runs. Set before the first navigation, which is what the app reads.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/players/pack");
    await tearPack(page);

    // No ceremony at all — the rip deals the pack and hands straight over, which
    // is what this screen did before the ceremony existed.
    await expect(sealedPack(page)).toBeHidden();
    await expect(page.getByTestId("stand-step")).toHaveText("1 / 3");

    await page.getByRole("button", { name: /reveal all/i }).click();
    await expect(page.getByText(/pack complete/i)).toBeVisible({ timeout: 30_000 });
  });
});
