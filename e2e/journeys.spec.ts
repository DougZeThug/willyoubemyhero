// The flows that matter: getting in, seeing results, and opening a pack.
import {
  test,
  expect,
  BUNDLE,
  EVENT_ID,
  PLAYERS,
  sealedPack,
  serverFnName,
  stubServerFns,
  tearPack,
} from "./fixtures";
// The same pure functions the pack route deals from, so these tests can compute
// the pack they expect rather than guess at one. With a four-player fixture and
// a three-card pack, "assert two packs differ" collides often enough to be flaky;
// "assert this pack is the one this identity earns" never does.
import { dealPack, packSeed } from "../src/lib/pack";
import { editionLabel } from "../src/lib/card-edition";
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
    // The only test here that gets past the gate, and the console behind it
    // reads the award tally, the ownership audit, the card-prompt templates and
    // runs, and the member claims. This test has no opinion about any of them —
    // it is about the PIN and the token — and inventing five admin payloads to
    // satisfy the strict stub would be fiction rather than fixture.
    server.allowUnmatched();
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
  test("asks a signed-out visitor for a name before their first reaction", async ({
    page,
    server,
  }) => {
    // The tap survives the prompt, which means it is re-fired against the server
    // once the name lands. A mutation, so it is not defaulted — see the trade
    // handlers in e2e/fixtures.ts for why.
    server.set("toggleReaction", { ok: true, reacted: true });
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

    // The load-bearing half, and until now the unasserted one: the stashed tap
    // is replayed, so the guest does not have to react a second time. Exactly
    // once — twice would mean they did.
    //
    // Read off the calls rather than the count beside the emoji, because that
    // count is optimistic and the stubbed refresh takes it straight back off
    // again — an assertion on it would pass or fail on timing, not behaviour.
    await expect
      .poll(() => server.calls.filter((c) => c.includes("toggleReaction")).length)
      .toBe(1);
  });
});

test.describe("opening a pack", () => {
  const PACK_SIZE = 3;

  /**
   * Today's pack row straight out of IndexedDB, or null if nothing is stored.
   *
   * Spelled out here rather than imported, so a field disappearing from the real
   * type is caught by an assertion rather than by the shape silently widening.
   */
  type PackState = {
    dayKey: string;
    ids: string[];
    revealed: number[];
    cursor?: number;
    identity?: string;
    carriedFrom?: string;
  };

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
    //
    // The first tap has to actually start that hold, or all three bounce off the
    // previous card's celebration — `revealAt` holds the very latch this test is
    // about for the whole of it — and nothing below is testing anything.
    //
    // "Last card…" is that hold on screen: it renders for exactly as long as the
    // card is held face-down. Pressing until it appears is safe in a way the same
    // loop would NOT be around the walk above, and the difference is worth
    // stating. Here an extra press lands on a card that is still face-down and is
    // swallowed by the latch, which is the scenario. There it would land on a
    // card that has already turned, and the stand's own copy is "tap for the
    // back" — it would flip the card and the swipe that follows would find
    // nothing to throw away. That is not hypothetical: it is what this test did
    // on CI when the walk was written that way.
    const card = standCard(page);
    const holding = page.getByText(/last card/i);
    await expect
      .poll(
        async () => {
          if (await holding.count()) return true;
          await card.click();
          await page.waitForTimeout(250);
          return (await holding.count()) > 0;
        },
        { timeout: 20_000, intervals: [200] },
      )
      .toBe(true);
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

  test("prints the finish the server derived, and keeps it across a reload", async ({
    page,
    server,
  }) => {
    // Stubbed rather than searched for. This used to hunt through two hundred
    // device ids for one whose first card rolled non-standard, because the finish
    // was a pure function of the pack seed and the test could compute it. It is a
    // server answer now, so the stub simply says what the server said.
    // PLATINUM, not gold, and that is not arbitrary: card-rarity.ts labels the
    // podium tier "Gold" as well, so getByText("Gold") matches a second-place
    // card's rarity badge and has nothing to do with its finish. Platinum,
    // silver and bronze are the three finish labels no rarity label collides
    // with.
    const device = "finish-device";
    const ids = expectedPack(`d:${device}`);
    server.set("recordCardPulls", {
      ok: true,
      recorded: ids.length,
      packsOpened: 1,
      editions: { [ids[0]]: "platinum" },
    });
    const label = editionLabel("platinum")!;

    await page.addInitScript((d: string) => {
      localStorage.setItem("wwbh:device-id", d);
    }, device);
    await page.goto("/players/pack");
    await tearPack(page);

    // Nothing before the turn: a badge on a face-down card spends the reveal.
    await expect(page.getByText(label, { exact: false })).toBeHidden();
    await standCard(page).click();
    await expect(page.getByText(label, { exact: false }).first()).toBeVisible();

    // The finish is derived from (participant, card, league day) rather than
    // stored on the device, so a reload has to ask again and be told the same
    // thing. That idempotence is what the client's deterministic seed used to buy.
    await page.reload();
    await expect(page.getByText(label, { exact: false }).first()).toBeVisible();
  });

  test("reveals a standard rather than a finish the server has not answered with", async ({
    page,
    server,
  }) => {
    // The failure the whole round trip is designed around: a card can be turned
    // over before the record lands. It must show the plainest thing and correct
    // itself, never a rare nobody has decided on.
    //
    // Failed rather than merely slow, because a delay races the tear ceremony —
    // which takes long enough that the answer usually beats the first tap, and a
    // test that has to lose that race is a test that flakes when the ceremony is
    // retimed. The route retries on its own (0/4s/8s), so recovering mid-flight
    // exercises the real path.
    // Platinum for the same reason as the test above: "Gold" is also a rarity
    // label, so it would match a podium card's badge whatever the finish is.
    const device = "slow-finish-device";
    const ids = expectedPack(`d:${device}`);
    server.set("recordCardPulls", {
      ok: true,
      recorded: ids.length,
      packsOpened: 1,
      editions: { [ids[0]]: "platinum" },
    });
    server.fail("recordCardPulls", "offline at the tear");
    const label = editionLabel("platinum")!;

    await page.addInitScript((d: string) => {
      localStorage.setItem("wwbh:device-id", d);
    }, device);
    await page.goto("/players/pack");
    await tearPack(page);
    await standCard(page).click();

    // Turned, and carrying no claim about its finish.
    await expect(page.getByText(label, { exact: false })).toBeHidden();

    // Then the network comes back, the retry lands, and the card tells the truth
    // without anybody touching it.
    server.recover("recordCardPulls");
    await expect(page.getByText(label, { exact: false }).first()).toBeVisible({ timeout: 30_000 });
  });

  test("records the new day's pack when a tab is left open across midnight", async ({
    page,
    server,
  }) => {
    // A phone in a garden stays open overnight. The actor does not change, and
    // the effect that re-arms the pack used to key on the actor alone — so the
    // record latch stayed set and the new day's pack was never filed at all,
    // while the previous day's edition map survived to shine on a card the server
    // had granted nothing for.
    //
    // The wall clock is moved with setFixedTime rather than clock.install(): the
    // reveal ceremony runs on real timers and animations, and faking those to
    // move a date would be testing the fake.
    const device = "midnight-device";
    const ids = expectedPack(`d:${device}`);
    server.set("recordCardPulls", {
      ok: true,
      recorded: ids.length,
      packsOpened: 1,
      editions: { [ids[0]]: "platinum" },
    });
    const label = editionLabel("platinum")!;

    await page.addInitScript((d: string) => {
      localStorage.setItem("wwbh:device-id", d);
    }, device);
    await page.goto("/players/pack");
    await tearPack(page);
    await standCard(page).click();
    await expect(page.getByText(label, { exact: false }).first()).toBeVisible();

    const before = server.calls.filter((c) => c.includes("recordCardPulls")).length;
    expect(before).toBeGreaterThan(0);

    // Tomorrow, and a visibility flip — the same signal a phone waking up sends,
    // and the one the route polls the date on.
    const tomorrow = new Date(Date.now() + 26 * 60 * 60 * 1000);
    await page.clock.setFixedTime(tomorrow);

    // Dispatched on a poll rather than once. The route refuses to re-seal a pack
    // out from under a reveal — `revealingRef` is still set while a platinum's
    // celebration plays — so a single nudge lands too early and is correctly
    // ignored. Waiting for the seal is waiting for that guard to clear.
    await expect
      .poll(
        async () => {
          await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
          return page.getByText(label, { exact: false }).count();
        },
        { timeout: 25_000 },
      )
      .toBe(0);

    // A fresh pack, sealed again, and the day's record actually fires for it.
    await tearPack(page);
    await expect
      .poll(() => server.calls.filter((c) => c.includes("recordCardPulls")).length, {
        timeout: 20_000,
      })
      .toBeGreaterThan(before);
  });

  test("sends nothing when the retry loop sleeps through midnight", async ({ page, server }) => {
    // The loop waits up to twelve seconds between attempts and re-arms on
    // `online`, so a phone in a garden dead spot at 23:59 can wake with the radio
    // back at 00:01 — and `record_card_pulls` rations on the league day it is
    // CALLED on, so those same three cards would be minted afresh and a pack_open
    // written for a day nobody opened a pack on. The day tick eventually notices
    // and re-seals, but "eventually" is up to a minute, and the loop wakes first.
    //
    // A 90-day token, the length a real member token actually has: an hour-long
    // one would expire under the shift below, drop the member session, and
    // re-seal the pack for a reason that has nothing to do with this.
    await page.addInitScript(([key, token]) => localStorage.setItem(key, token), [
      MEMBER_KEY,
      `m.p-alice.${Date.now() + 90 * 24 * 60 * 60_000}.signature`,
    ] as const);
    // Vouches for nothing, so the prune at the end is real and the protection
    // means something. Same reason the unrecorded-row test sets it.
    server.set("getMyCardStats", { cards: [], packsOpened: 0, firstPackOn: null });
    server.fail("recordCardPulls", "a dead spot at the turn of the day");

    const records = () => server.calls.filter((c) => c.includes("recordCardPulls")).length;
    await page.goto("/players/pack");
    await tearPack(page);
    // The first attempt goes out and dies. The loop is now asleep, four seconds
    // before the second and twelve before the third.
    await expect.poll(records, { timeout: 20_000 }).toBe(1);

    // And midnight lands in that sleep.
    //
    // `Date` is shifted by hand rather than with `page.clock`, which also freezes
    // what React's scheduler reads — a state update made after it may then never
    // flush, and an assertion that a request does NOT go out would pass for the
    // wrong reason. This proved exactly that before it was written this way. Only
    // `Date` moves; `performance.now`, and so every timer, is left alone.
    await page.evaluate(
      (offset: number) => {
        const Real = Date;
        window.Date = new Proxy(Real, {
          construct: (target, args) =>
            args.length === 0
              ? new target(Real.now() + offset)
              : new target(...(args as unknown as [])),
          get: (target, prop) =>
            prop === "now" ? () => Real.now() + offset : Reflect.get(target, prop),
        });
      },
      26 * 60 * 60 * 1000,
    );
    // The signal comes back, so nothing but the day is stopping the next attempt.
    server.recover("recordCardPulls");

    // Turn the cards while it sleeps, which is what a person would be doing.
    await page.getByRole("button", { name: /reveal all/i }).click();
    await expect(page.getByText(/pack complete/i)).toBeVisible({ timeout: 30_000 });
    // Comfortably past both of the loop's remaining wakes, and comfortably short
    // of the sixty-second day tick — so what is being asserted here is the loop's
    // own guard and not the re-seal that eventually follows it.
    await page.waitForTimeout(6_000);
    expect(records()).toBe(1);

    // And the cards are still here. The unrecorded row is deliberately not scoped
    // to today — a pull the league has never heard of does not stop being one
    // because the date rolled over — so it goes on holding them out of the prune.
    await page.goto("/players");
    await expect(page.getByRole("heading", { name: /the vault/i })).toBeVisible();
    await expect(page.getByText(/not packed yet/i)).toHaveCount(PLAYERS.length - PACK_SIZE);
  });

  test("carries a guest's pack across a claim instead of dealing a second one", async ({
    page,
    server,
  }) => {
    // B-07, on the commonest first-timer path there is: somebody plays as a
    // guest, tears today's pack, is asked to claim a player, does, and comes
    // back. The stored pack is keyed on who they were, so claiming used to look
    // exactly like the handset changing hands — a second pack for the same day,
    // and its three copies minted on top of the three the claim just adopted.
    //
    // Searched for rather than pinned: the fixture roster is four players deep,
    // so an arbitrary device id deals the same three cards as Alice's member pack
    // on some days, and this assertion has to be a real one every day.
    const device = Array.from({ length: 60 }, (_, i) => `carry-${i}`).find(
      (d) => expectedPack(`d:${d}`).join() !== expectedPack("m:p-alice").join(),
    );
    expect(device, "no guest device id produced a pack unlike Alice's").toBeTruthy();
    const guestIds = expectedPack(`d:${device}`);

    const expiresAt = Date.now() + 90 * 24 * 60 * 60_000;
    server.set("claimPlayer", {
      ok: true,
      token: `m.p-alice.${expiresAt}.signature`,
      expiresAt,
      name: "Alice Ace",
    });
    // The claim adopts the handset's cards before it carries the pack, and a
    // failed adoption takes the member token back off — so an unstubbed one would
    // end this test on the claim screen rather than at the bug. One card, because
    // only one will have been turned over by then.
    server.set("adoptCollection", { ok: true, adopted: 1 });

    // Every `recordCardPulls` this page sent, and whether it went out as the
    // member. The token is the precise signal: the guest files the whole pack at
    // the tear, so a body alone cannot tell the two callers apart.
    //
    // Bodies are matched as raw text: a server-function REQUEST is seroval
    // cross-JSON just as the response is, so the ids arrive as
    // `{"t":1,"s":"ep-dave"}` rather than as an array anything can destructure.
    // Quoted, so no id can match half of another.
    const filed: { body: string; asMember: boolean }[] = [];
    page.on("request", (req) => {
      if (!req.url().includes("/_serverFn/")) return;
      if (!serverFnName(req.url()).includes("recordCardPulls")) return;
      filed.push({ body: req.postData() ?? "", asMember: !!req.headers()["x-member-token"] });
    });
    const filedBy = (asMember: boolean, ids: string[]) =>
      filed.filter((f) => f.asMember === asMember && ids.every((id) => f.body.includes(`"${id}"`)))
        .length;

    await page.addInitScript((d: string) => {
      localStorage.setItem("wwbh:device-id", d);
    }, device!);

    // As a guest: tear, and turn the first card, so a re-deal would be visible as
    // lost progress and not just as different ids.
    await page.goto("/players/pack");
    await tearPack(page);
    await standCard(page).click();
    await expect.poll(async () => (await readPackState(page))?.revealed).toEqual([0]);
    const dealt = (await readPackState(page))!;
    expect(dealt.ids).toEqual(guestIds);
    expect(dealt.identity).toBe(`d:${device}`);
    // The guest files the whole pack, as they always did.
    await expect.poll(() => filedBy(false, guestIds)).toBeGreaterThan(0);

    // They claim their player.
    await page.goto("/claim");
    await page.getByRole("button", { name: /Alice Ace/i }).click();
    await page.getByRole("textbox").fill("ACDEF4");
    await page
      .getByRole("button", { name: /claim|unlock|submit/i })
      .last()
      .click();
    await expect(page).toHaveURL(/\/players/);

    // The pack came with them, cards and progress and all, and it remembers who
    // it was dealt to.
    await expect.poll(async () => (await readPackState(page))?.identity).toBe("m:p-alice");
    const carried = (await readPackState(page))!;
    expect(carried.ids).toEqual(guestIds);
    expect(carried.revealed).toEqual([0]);
    expect(carried.carriedFrom).toBe(`d:${device}`);

    // And back on the pack screen it is the pack they already tore. No wrapper,
    // and no second deal.
    await page.goto("/players/pack");
    await expect(sealedPack(page)).toBeHidden();
    expect((await readPackState(page))?.ids).toEqual(guestIds);

    // The two cards still face-down at the claim were in no snapshot, so
    // adoption never heard about them and this record is the only thing that
    // will ever file them.
    await expect.poll(() => filedBy(true, [guestIds[1], guestIds[2]])).toBeGreaterThan(0);
    // But never the one they had turned. Adoption filed that, and
    // `record_card_pulls` rations on card_mints rather than on copies — so
    // re-sending it mints a SECOND copy and re-rolls its finish. Six copies for
    // one league day is the thing B-07 actually costs.
    //
    // A fixed wait for the same reason the midnight test has one: the assertion
    // is that a request does not go out, and there is nothing to poll for.
    await page.waitForTimeout(6_000);
    expect(filedBy(true, [guestIds[0]])).toBe(0);
    expect((await readPackState(page))?.ids).toEqual(guestIds);
  });

  test("a second tab picks the pack up rather than dealing over it", async ({ page, server }) => {
    // IndexedDB fires no cross-tab event, so a tab opened before the tear sat on
    // a sealed wrapper forever — and tearing there dealt the same ids and wrote
    // `revealed: []` and `cursor: 0` over the first tab's progress. Both tabs are
    // in one context on purpose: that is what shares the storage this turns on.
    const device = "two-tab-device";
    const ids = expectedPack(`d:${device}`);
    const seed = (p: import("@playwright/test").Page) =>
      p.addInitScript((d: string) => {
        localStorage.setItem("wwbh:device-id", d);
      }, device);

    await seed(page);
    const other = await page.context().newPage();
    try {
      await seed(other);
      await stubServerFns(other);

      // The second tab opens FIRST, and sits on the wrapper.
      await other.goto(`${BASE_URL}/players/pack`);
      await expect(sealedPack(other)).toBeVisible();

      // The first tab tears and turns a card.
      await page.goto("/players/pack");
      await tearPack(page);
      await standCard(page).click();
      await expect.poll(async () => (await readPackState(page))?.revealed).toEqual([0]);

      // The other tab hears about it and picks the same pack up, unsealed.
      await expect(sealedPack(other)).toBeHidden();
      expect((await readPackState(other))?.ids).toEqual(ids);

      // And the first tab's progress is still there — which is the half that was
      // actually being lost.
      await expect.poll(async () => (await readPackState(other))?.revealed).toEqual([0]);
      await page.waitForTimeout(2_000);
      const row = (await readPackState(page))!;
      expect(row.ids).toEqual(ids);
      expect(row.revealed).toEqual([0]);
    } finally {
      await other.close();
    }
    // Nothing about the stub in the other tab should have leaked into this one.
    expect(server.calls.length).toBeGreaterThan(0);
  });

  test("does not stamp the guest's row with the member's name when the claim is in another tab", async ({
    page,
  }) => {
    // The pack tab is idle and torn; the claim happens beside it. `setMemberToken`
    // fires `storage`, so this tab's `identity` becomes the member a whole render
    // before its own resume load can answer — and the save effect runs on that
    // render, with `stateLoaded` still true. It used to write the guest's pack row
    // under the member's name, and `carryPackToIdentity` then refused a row it no
    // longer recognised: the pack stayed but was never marked as carried, so the
    // record loop minted every card in it a second time. The exact bug B-07 is
    // about, reached from the side.
    const device = "handoff-tab-device";
    const guestIds = expectedPack(`d:${device}`);
    const seed = (p: import("@playwright/test").Page) =>
      p.addInitScript((d: string) => {
        localStorage.setItem("wwbh:device-id", d);
      }, device);

    await seed(page);
    const claimTab = await page.context().newPage();
    try {
      await seed(claimTab);
      const claimServer = await stubServerFns(claimTab);
      const expiresAt = Date.now() + 90 * 24 * 60 * 60_000;
      claimServer.set("claimPlayer", {
        ok: true,
        token: `m.p-alice.${expiresAt}.signature`,
        expiresAt,
        name: "Alice Ace",
      });
      claimServer.set("adoptCollection", { ok: true, adopted: 1 });
      // Held back on purpose. The token lands before the adoption resolves, so
      // this is the window the pack tab used to write into — widened from
      // milliseconds to six seconds so the race is decided the same way on every
      // machine rather than by whichever runner is quicker today, and so there is
      // room to look at the pack tab while it is still open.
      claimServer.delay("adoptCollection", 6_000);

      // The pack tab, torn and idle with one card turned.
      await page.goto("/players/pack");
      await tearPack(page);
      await standCard(page).click();
      await expect.poll(async () => (await readPackState(page))?.revealed).toEqual([0]);

      // And the claim, beside it.
      await claimTab.goto(`${BASE_URL}/claim`);
      await claimTab.getByRole("button", { name: /Alice Ace/i }).click();
      await claimTab.getByRole("textbox").fill("ACDEF4");
      await claimTab
        .getByRole("button", { name: /claim|unlock|submit/i })
        .last()
        .click();
      // Synchronised on the adoption actually being in the air rather than on a
      // fixed sleep: the window this is about opens when the token lands and
      // closes when the carry runs, and only the request tells us we are inside
      // it. While we are, the pack tab holds the member's identity and a row that
      // is still the guest's — and it waits rather than re-sealing, so the cards
      // stay on screen and there is no wrapper for a fast tap to deal a second
      // pack from.
      await expect
        .poll(() => claimServer.calls.filter((c) => c.includes("adoptCollection")).length)
        .toBeGreaterThan(0);
      // A beat inside that window, not the edge of it: the identity reaches this
      // tab through a `storage` event and its resume load is asynchronous, so
      // looking the instant the request goes out is looking before anything can
      // have happened.
      await page.waitForTimeout(2_500);
      // And then the tap, which is the actual risk. Held, there is no wrapper to
      // press and this does nothing. Unheld, the tab has re-sealed and this deals
      // a second pack straight over the one being carried — after which the carry
      // finds a row it does not recognise and the assertions below fail.
      if (await sealedPack(page).count()) await sealedPack(page).press("Enter");

      await expect(claimTab).toHaveURL(/\/players/, { timeout: 20_000 });

      // The carry found the row it was looking for.
      await expect.poll(async () => (await readPackState(page))?.identity).toBe("m:p-alice");
      const row = (await readPackState(page))!;
      expect(row.carriedFrom).toBe(`d:${device}`);
      expect(row.ids).toEqual(guestIds);
      expect(row.revealed).toEqual([0]);

      // And the pack tab is still holding the same pack, not a sealed wrapper.
      await expect(sealedPack(page)).toBeHidden();
      await page.waitForTimeout(2_000);
      expect((await readPackState(page))?.carriedFrom).toBe(`d:${device}`);
    } finally {
      await claimTab.close();
    }
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

  test("retries the day's record once the network comes back", async ({ page, server }) => {
    // recordCardPulls is fire-and-forget by design, but a fire that failed used
    // to latch as done — one garden dead spot at tear time silently lost the
    // day's card_pulls and pack_opens. The route hands the latch back on
    // failure and tries again after a pause, without any input from the person.
    await page.addInitScript(([key, token]) => localStorage.setItem(key, token), [
      MEMBER_KEY,
      `m.p-alice.${Date.now() + 60 * 60_000}.signature`,
    ] as const);
    server.fail("recordCardPulls", "offline at the tear");

    await page.goto("/players/pack");
    await tearPack(page);

    // The first attempt goes out and dies.
    await expect
      .poll(() => server.calls.filter((c) => c.includes("recordCardPulls")).length)
      .toBeGreaterThan(0);
    const failed = server.calls.filter((c) => c.includes("recordCardPulls")).length;

    // Signal returns; the record lands on its own.
    server.recover("recordCardPulls");
    await expect
      .poll(() => server.calls.filter((c) => c.includes("recordCardPulls")).length, {
        timeout: 15_000,
      })
      .toBeGreaterThan(failed);
  });

  test("a record that exhausted its retries wakes up when the network does", async ({
    page,
    server,
  }) => {
    // The latch is a ref, so handing it back after the third failure re-runs
    // nothing by itself — and once a pack is torn the effect's deps sit still.
    // The browser's own online signal is what re-arms the next cycle.
    await page.addInitScript(([key, token]) => localStorage.setItem(key, token), [
      MEMBER_KEY,
      `m.p-alice.${Date.now() + 60 * 60_000}.signature`,
    ] as const);
    server.fail("recordCardPulls", "a long dead spot");

    await page.goto("/players/pack");
    await tearPack(page);

    // All three attempts of the first cycle go out and die (~0s, 4s, 12s in).
    await expect
      .poll(() => server.calls.filter((c) => c.includes("recordCardPulls")).length, {
        timeout: 25_000,
      })
      .toBe(3);

    server.recover("recordCardPulls");
    await page.evaluate(() => window.dispatchEvent(new Event("online")));

    await expect
      .poll(() => server.calls.filter((c) => c.includes("recordCardPulls")).length, {
        timeout: 10_000,
      })
      .toBeGreaterThan(3);
  });

  test("keeps a pack it never managed to record, across a reload", async ({ page, server }) => {
    // The cards are in IndexedDB the moment they are turned over, and the merge
    // deletes anything the server does not vouch for — so a pack torn in a dead
    // spot used to be collected, shown, and then deleted on the next load. The
    // in-memory floor covered the session that pulled them and nothing after it.
    await page.addInitScript(([key, token]) => localStorage.setItem(key, token), [
      MEMBER_KEY,
      `m.p-alice.${Date.now() + 60 * 60_000}.signature`,
    ] as const);
    // An answer that vouches for nothing, which is what makes this a real test:
    // there is no getMyCardStats default, and an unstubbed null reads as "nobody
    // is claimed here" and prunes nothing whatever the route does.
    server.set("getMyCardStats", { cards: [], packsOpened: 0, firstPackOn: null });
    // No recover: this pack never reaches the league at all.
    server.fail("recordCardPulls", "a dead spot that lasts");

    await page.goto("/players/pack");
    await tearPack(page);
    await page.getByRole("button", { name: /reveal all/i }).click();
    await expect(page.getByText(/pack complete/i)).toBeVisible({ timeout: 30_000 });

    const dealt = (await readPackState(page))!.ids;
    expect(dealt).toHaveLength(PACK_SIZE);

    // The reload is the whole point: the floor that protected these cards while
    // they were being turned lives in memory and does not survive it.
    await page.reload();
    await expect(sealedPack(page)).toBeHidden();
    expect((await readPackState(page))?.ids).toEqual(dealt);

    await page.goto("/players");
    await expect(page.getByRole("heading", { name: /the vault/i })).toBeVisible();
    // One slot still shut on a four-player fixture. Before this, all four were:
    // the three cards had been deleted from the device.
    await expect(page.getByText(/not packed yet/i)).toHaveCount(PLAYERS.length - PACK_SIZE);
  });

  test("says so when the league cannot be reached, rather than sitting there", async ({
    page,
    server,
  }) => {
    // With no active event there is no roster, so `tearOpen` refuses — and it
    // refuses silently. A member got a sealed pack that did nothing when pressed
    // and no way to ask again.
    await page.addInitScript(([key, token]) => localStorage.setItem(key, token), [
      MEMBER_KEY,
      `m.p-alice.${Date.now() + 60 * 60_000}.signature`,
    ] as const);
    server.fail("getActiveEvent", "the league is unreachable");

    await page.goto("/players/pack");
    // Longer than the 15s default on purpose. The screen is not allowed to call
    // the read failed until TanStack Query has finished retrying it — three
    // attempts at 1s, 2s and 4s — so several seconds of sealed pack is the
    // correct behaviour here, not a slow test.
    await expect(page.getByText(/safe on this phone/i)).toBeVisible({ timeout: 30_000 });
    await expect(sealedPack(page)).toBeHidden();

    // And the way back, without a reload.
    server.recover("getActiveEvent");
    await page.getByRole("button", { name: /try again/i }).click();
    await expect(sealedPack(page)).toBeVisible();
  });

  test("says so on a pack already torn, where the screen used to hang", async ({
    page,
    server,
  }) => {
    // The commonest shape of the outage above, and the one an error card above
    // the wrapper would never have reached: the dealt ids come back from
    // IndexedDB, so the route counts the pack as torn while the roster behind it
    // is empty — and the loading guard sat on "Loading…" for the rest of the day.
    await page.addInitScript(([key, token]) => localStorage.setItem(key, token), [
      MEMBER_KEY,
      `m.p-alice.${Date.now() + 60 * 60_000}.signature`,
    ] as const);

    await page.goto("/players/pack");
    await tearPack(page);
    await expect.poll(() => readPackState(page)).not.toBeNull();

    server.fail("getActiveEvent", "the league went away mid-party");
    await page.reload();
    // Same retry budget as the test above buys the read before it counts as lost.
    await expect(page.getByText(/safe on this phone/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/^Loading…$/)).toBeHidden();
  });
});

test.describe("navigation", () => {
  /**
   * Every tab, clicked for real.
   *
   * This used to skip any link it could not see, which meant it passed on a nav
   * that had stopped rendering — and the nav has just been rebuilt around the
   * cards, so a silently-skipping nav test is worth less than no nav test.
   *
   * Scoped to the nav rather than the page: exactly one of the two bars is in
   * the accessibility tree at a given width (the other is display:none), so this
   * resolves to one tab in the phone and desktop projects alike, and it does not
   * collide with the pack screen's back-link, which is also named "Vault".
   */
  test("every tab goes where it says", async ({ page }) => {
    // Six navigations, each landing on a route the dev server compiles for the
    // first time. That is minutes of work on a cold cache and comfortably past
    // the default per-test budget — the walk is the point, so buy it the time
    // rather than shortening it into a test that stops covering the last tabs.
    test.slow();
    await page.goto("/");
    const nav = page.getByRole("navigation");

    for (const [name, url] of [
      [/^vault$/i, /\/players$/],
      [/^pack$/i, /\/players\/pack$/],
      [/^trade$/i, /\/players\/trade$/],
      [/^board$/i, /\/leaderboard$/],
      [/^league$/i, /\/league$/],
    ] as const) {
      await nav.getByRole("link", { name }).click();
      await expect(page).toHaveURL(url);
    }

    // And the combine screens the tabs gave up are one tap further in. Scoped to
    // the page so the tile is matched and not some future nav entry.
    await page.getByRole("main").getByRole("link", { name: /^live/i }).click();
    await expect(page).toHaveURL(/\/live$/);
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
