// The flows that matter: getting in, seeing results, and opening a pack.
import {
  test,
  expect,
  BUNDLE,
  DEFAULT_PACK_IDS,
  LEAGUE_DAY,
  leagueDayAt,
  packResponse,
  PLAYERS,
  rosterSlot,
  sealedPack,
  serverFnName,
  stubServerFns,
  tearPack,
  standCard,
  swipeNext,
  turnCard,
} from "./fixtures";
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
    // This is the window the leak lived in: every card was face-down, and a sort
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
    server.delay("getMyCardStats", 3000);

    await page.goto("/players");

    // The window itself, which the skeletons closed from the other end: while
    // the answer is out there is no grid to order at all, so there is nothing
    // for a sort to name. Asserted rather than assumed — a shelf that went back
    // to drawing backs here would reopen the leak below.
    await expect(page.getByTestId("card-skeleton")).toHaveCount(PLAYERS.length);
    const slots = page.locator('[role="img"][aria-label$="not packed yet"]');
    await expect(slots).toHaveCount(0);

    // Then the answer lands: nobody owns anything, so every slot is face-down
    // for real and the sentinel rank is still the only rank any of them has.
    // Waiting for the grid also matters for the click — the sort buttons ship in
    // the SSR html and the roster does not, so a click any earlier lands on an
    // unhydrated button, does nothing, and leaves the grid in its default name
    // order, which is the order this test asserts. It would have passed against
    // the leak it exists to catch.
    await expect(slots).toHaveCount(PLAYERS.length);
    // Sorting lives in a bottom sheet now, so the chip comes first. The wait
    // above still matters for the same reason: the header ships in the SSR html
    // and the roster does not, so a tap any earlier lands on an unhydrated
    // control, does nothing, and leaves the grid in its default name order —
    // which is the order this test asserts, so it would pass against the leak it
    // exists to catch.
    await page.getByRole("button", { name: /sort and filter/i }).click();
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
    cards?: { kind: string; id: string }[];
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

    // Walk to the last card. Every card here is a first, so every one holds
    // before it turns; the last is simply the one with nothing to swipe on to.
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
    // "New card…" is that hold on screen: it renders for exactly as long as the
    // card is held face-down. Pressing until it appears is safe in a way the same
    // loop would NOT be around the walk above, and the difference is worth
    // stating. Here an extra press lands on a card that is still face-down and is
    // swallowed by the latch, which is the scenario. There it would land on a
    // card that has already turned, and the stand's own copy is "tap for the
    // back" — it would flip the card and the swipe that follows would find
    // nothing to throw away. That is not hypothetical: it is what this test did
    // on CI when the walk was written that way.
    const card = standCard(page);
    const holding = page.getByText(/new card…/i);
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

  test("treats a row the old client wrote as sealed, and asks the server", async ({ page }) => {
    // Before the server dealt packs, the row carried three ids and nothing
    // about which slot was which. Such a row is not today's pack: the server is
    // the one that knows, and it either resumes today's or deals it.
    await page.addInitScript((dayKey: string) => {
      const open = indexedDB.open("wwbh-cards", 2);
      open.onupgradeneeded = () => {
        const db = open.result;
        for (const name of ["collected", "card-meta", "pack-state"]) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
        }
      };
      open.onsuccess = () => {
        open.result
          .transaction("pack-state", "readwrite")
          .objectStore("pack-state")
          .put({ dayKey, ids: ["ep-alice", "ep-bob", "ep-carol"], revealed: [0, 1, 2] }, "today");
      };
    }, LEAGUE_DAY);

    await page.goto("/players/pack");
    await expect(sealedPack(page)).toBeVisible();
    await tearPack(page);
    await expect(page.getByTestId("stand-step")).toHaveText("1 / 3");
    expect((await readPackState(page))?.cards?.map((c) => c.id)).toEqual(DEFAULT_PACK_IDS);
  });

  test("keeps the summary's cards big enough to read", async ({ page }) => {
    // The pack used to get SMALLER at the payoff: a three-column grid put the
    // roster cards at ~100px on a phone, a second after the stand had shown the
    // same card at 315. They are a snap row now, so they keep a readable size
    // and the row scrolls instead of the cards shrinking.
    //
    // 390 is the mobile project's own width (iPhone 13), which is the width the
    // floor was chosen for; the desktop project is wider and passes the same
    // assertion for free.
    await page.setViewportSize({ width: 390, height: 780 });
    await page.goto("/players/pack");
    await tearPack(page);
    await page.getByRole("button", { name: /reveal all/i }).click();
    await expect(page.getByText(/pack complete/i)).toBeVisible({ timeout: 30_000 });

    const columns = page.getByTestId("summary-card");
    await expect(columns).toHaveCount(PACK_SIZE);
    for (let i = 0; i < PACK_SIZE; i += 1) {
      const box = (await columns.nth(i).boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(140);
    }
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

    // Which card the pack leaves out is the server's decision, so it is read
    // off the vault rather than assumed.
    await page.goto("/players");
    const shut = page.locator('[role="img"][aria-label$="not packed yet"]');
    await expect(shut).toHaveCount(PLAYERS.length - PACK_SIZE);
    const shutName = (await shut.first().getAttribute("aria-label"))!.split(" — ")[0];
    const tiles = await page
      .locator('a[href^="/players/ep-"]')
      .evaluateAll((els) =>
        els.map((e) => [e.getAttribute("href")!, e.textContent ?? ""] as const),
      );
    // Paths only. Since §7 a vault tile links to `?view=1`, which opens the
    // full-screen viewer — and this test is about the details page underneath it:
    // the Compare chip and the filmstrip both live there.
    const path = (href: string) => new URL(href, "http://x").pathname;
    const packed = path(tiles.find(([, text]) => !text.includes(shutName))![0]);
    const shutHref = path(tiles.find(([, text]) => text.includes(shutName))![0]);

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
    // Exactly what the server dealt, and only roster ids in `ids`.
    expect(state.ids).toHaveLength(PACK_SIZE);
    expect(state.ids).toEqual(DEFAULT_PACK_IDS);
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
    prime?: (server: Awaited<ReturnType<typeof stubServerFns>>) => void,
  ) {
    // A page from browser.newPage() has no baseURL of its own, so the path is
    // resolved against the config's here rather than against page.url() — which
    // is "about:blank" until something navigates.
    const other = await browser.newPage({ baseURL: BASE_URL });
    try {
      const server = await stubServerFns(other);
      prime?.(server);
      await other.addInitScript((entries: [string, string][]) => {
        for (const [k, v] of entries) localStorage.setItem(k, v);
      }, Object.entries(storage));
      await other.goto("/players/pack");
      await tearPack(other);
      await expect.poll(() => readPackState(other)).not.toBeNull();
      return { ids: (await readPackState(other))!.ids, server };
    } finally {
      await other.close();
    }
  }

  const memberToken = (pid: string) => `m.${pid}.${Date.now() + 60 * 60_000}.signature`;

  test("asks the server for the pack once per tear, and stores what it answered", async ({
    browser,
  }) => {
    // The whole point of the change: nothing on the phone decides the cards.
    // One deal per tear, and the row is exactly the server's answer.
    const { ids, server } = await packFor(browser, {
      "wwbh:member-token": memberToken("p-alice"),
      "wwbh:member-name": "Alice Ace",
      "wwbh:device-id": "device-one",
    });
    expect(ids).toEqual(DEFAULT_PACK_IDS);
    expect(server.calls.filter((c) => c.includes("openPack"))).toHaveLength(1);
  });

  test("a second phone picks up the pack the server already dealt", async ({ browser }) => {
    // Packs are per *person*: a member on a second handset has no row, tears
    // the wrapper, and the server answers the pack it dealt them on the first —
    // `fresh: false`, the same three cards, nothing minted twice.
    const dealt = [rosterSlot("ep-bob"), rosterSlot("ep-carol"), rosterSlot("ep-dave")];
    const { ids } = await packFor(
      browser,
      {
        "wwbh:member-token": memberToken("p-alice"),
        "wwbh:member-name": "Alice Ace",
        "wwbh:device-id": "device-two",
      },
      (server) => {
        server.set("getPackStatus", {
          claimed: true,
          day: LEAGUE_DAY,
          openedToday: true,
          secretsOwned: 0,
          resetsAt: `${LEAGUE_DAY}T04:00:00Z`,
        });
        server.set("openPack", packResponse(dealt, { fresh: false }));
      },
    );
    expect(ids).toEqual(dealt.map((s) => s.id));
  });

  test("prints the finish the server derived, and keeps it across a reload", async ({
    page,
    server,
  }) => {
    // The finish rides on the slot the server dealt. PLATINUM, not gold, and
    // that is not arbitrary: card-rarity.ts labels the podium tier "Gold" as
    // well, so getByText("Gold") matches a second-place card's rarity badge and
    // has nothing to do with its finish. Platinum, silver and bronze are the
    // three finish labels no rarity label collides with.
    const device = "finish-device";
    server.set(
      "openPack",
      packResponse([
        rosterSlot("ep-alice", { edition: "platinum" }),
        rosterSlot("ep-bob"),
        rosterSlot("ep-carol"),
      ]),
    );
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

    // The finish is stored on the pack the server dealt rather than on the
    // device, so a reload asks again and is told the same thing.
    await page.reload();
    await expect(page.getByText(label, { exact: false }).first()).toBeVisible();
  });

  test("reveals a standard for a copy the server did not mint a finish for", async ({
    page,
    server,
  }) => {
    // A rationed mint answers `edition: null`. The card shows the plainest thing
    // and claims nothing — never a rare nobody has decided on.
    server.set(
      "openPack",
      packResponse([
        rosterSlot("ep-alice", { edition: null }),
        rosterSlot("ep-bob"),
        rosterSlot("ep-carol"),
      ]),
    );
    await page.goto("/players/pack");
    await tearPack(page);
    await standCard(page).click();
    await expect(swipeHint(page)).toBeVisible();
    await expect(page.locator(".card-edition")).toHaveCount(0);
    await expect(page.getByText(/^(Platinum|Silver|Bronze)$/)).toHaveCount(0);
  });

  test("deals the new day's pack when a tab is left open across midnight", async ({
    page,
    server,
  }) => {
    // A phone in a garden stays open overnight. The actor does not change, so
    // the day tick is the only thing that can re-seal the pack — and the next
    // tear has to be a fresh deal, not the row from yesterday.
    //
    // The wall clock is moved with setFixedTime rather than clock.install(): the
    // reveal ceremony runs on real timers and animations, and faking those to
    // move a date would be testing the fake.
    const device = "midnight-device";
    server.set(
      "openPack",
      packResponse([
        rosterSlot("ep-alice", { edition: "platinum" }),
        rosterSlot("ep-bob"),
        rosterSlot("ep-carol"),
      ]),
    );
    const label = editionLabel("platinum")!;

    await page.addInitScript((d: string) => {
      localStorage.setItem("wwbh:device-id", d);
    }, device);
    await page.goto("/players/pack");
    await tearPack(page);
    await standCard(page).click();
    await expect(page.getByText(label, { exact: false }).first()).toBeVisible();

    const before = server.calls.filter((c) => c.includes("openPack")).length;
    expect(before).toBeGreaterThan(0);

    // Tomorrow, on the server as well as on the phone: the route trusts the
    // server's day while the wrapper is sealed, so a status still answering
    // today would pull the day straight back.
    const tomorrow = new Date(Date.now() + 26 * 60 * 60 * 1000);
    const nextDay = leagueDayAt(tomorrow);
    server.set("getPackStatus", {
      claimed: true,
      day: nextDay,
      openedToday: false,
      secretsOwned: 0,
      resetsAt: `${nextDay}T04:00:00Z`,
    });
    server.set("openPack", packResponse(undefined, { day: nextDay }));
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

    // A fresh pack, sealed again, and the new day's deal actually goes out.
    await tearPack(page);
    await expect
      .poll(() => server.calls.filter((c) => c.includes("openPack")).length, {
        timeout: 20_000,
      })
      .toBeGreaterThan(before);
    await expect.poll(async () => (await readPackState(page))?.dayKey).toBe(nextDay);
  });

  test("carries a guest's pack across a claim instead of dealing a second one", async ({
    page,
    server,
  }) => {
    // B-07, on the commonest first-timer path there is: somebody plays as a
    // guest, tears today's pack, is asked to claim a player, does, and comes
    // back. The stored pack is keyed on who they were, so claiming used to look
    // exactly like the handset changing hands — a second pack for the same day.
    const device = "carry-device";
    const guestIds = DEFAULT_PACK_IDS;

    const expiresAt = Date.now() + 90 * 24 * 60 * 60_000;
    server.set("claimPlayer", {
      ok: true,
      token: `m.p-alice.${expiresAt}.signature`,
      expiresAt,
      name: "Alice Ace",
    });
    // The claim adopts the handset's cards before it carries the pack, and a
    // failed adoption takes the member token back off — so an unstubbed one would
    // end this test on the claim screen rather than at the bug.
    server.set("adoptCollection", { ok: true, adopted: 1 });

    // Every `adoptCollection` this page sent. The claim files what the guest had
    // turned; the pack files the rest, one card at a time, as they are turned
    // after the claim.
    //
    // Bodies are matched as raw text: a server-function REQUEST is seroval
    // cross-JSON just as the response is, so the ids arrive as
    // `{"t":1,"s":"ep-dave"}` rather than as an array anything can destructure.
    // Quoted, so no id can match half of another.
    const filed: string[] = [];
    page.on("request", (req) => {
      if (!req.url().includes("/_serverFn/")) return;
      if (!serverFnName(req.url()).includes("adoptCollection")) return;
      filed.push(req.postData() ?? "");
    });
    const filedWith = (id: string) => filed.filter((body) => body.includes(`"${id}"`)).length;

    await page.addInitScript((d: string) => {
      localStorage.setItem("wwbh:device-id", d);
    }, device);

    // As a guest: tear, and turn the first card, so a re-deal would be visible as
    // lost progress and not just as different ids.
    await page.goto("/players/pack");
    await tearPack(page);
    await standCard(page).click();
    await expect.poll(async () => (await readPackState(page))?.revealed).toEqual([0]);
    const dealt = (await readPackState(page))!;
    expect(dealt.ids).toEqual(guestIds);
    expect(dealt.identity).toBe(`d:${device}`);

    // They claim their player.
    await page.goto("/claim");
    await page.getByRole("button", { name: /Alice Ace/i }).click();
    await page.getByRole("textbox").fill("ACDEF4");
    await page
      .getByRole("button", { name: /claim|unlock|submit/i })
      .last()
      .click();
    await expect(page).toHaveURL(/\/players/);
    // The claim adopted the one card that was turned, and nothing else.
    await expect.poll(() => filedWith(guestIds[0])).toBe(1);
    expect(filedWith(guestIds[1])).toBe(0);

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
    await expect(standStep(page)).toHaveText("1 / 3");
    expect((await readPackState(page))?.ids).toEqual(guestIds);

    // The cards still face-down at the claim were in no snapshot, so adoption
    // never heard about them — and the server minted nothing for a guest. The
    // reveal is the only thing that will ever file them, one at a time.
    await swipeNext(page);
    await expect(standStep(page)).toHaveText("2 / 3");
    // Pressed until it takes: the card ahead of this one has just celebrated,
    // and a tap into the tail of that is swallowed by revealAt's latch, leaving
    // nothing to file and the poll below to time out on a reveal that never ran.
    await turnCard(page);
    await expect.poll(() => filedWith(guestIds[1]), { timeout: 15_000 }).toBe(1);
    // But never again the one they had turned: adoption filed that at the claim.
    expect(filedWith(guestIds[0])).toBe(1);
    expect((await readPackState(page))?.ids).toEqual(guestIds);
  });

  test("a second tab picks the pack up rather than dealing over it", async ({ page, server }) => {
    // IndexedDB fires no cross-tab event, so a tab opened before the tear sat on
    // a sealed wrapper forever — and tearing there dealt the same ids and wrote
    // `revealed: []` and `cursor: 0` over the first tab's progress. Both tabs are
    // in one context on purpose: that is what shares the storage this turns on.
    const device = "two-tab-device";
    const ids = DEFAULT_PACK_IDS;
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
    // reveal filed every card in it a second time. The exact bug B-07 is about,
    // reached from the side.
    const device = "handoff-tab-device";
    const guestIds = DEFAULT_PACK_IDS;
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

  test("keeps the pack and its progress when a resume cannot reach the server", async ({
    page,
    server,
  }) => {
    // A reload asks the server for the pack again — a secret's art is signed
    // and expires. In a dead spot that ask fails, and the answer has to be a
    // retry over the progress the row already holds, never a re-seal and never
    // a pack started from the first card.
    await page.addInitScript(([key, token]) => localStorage.setItem(key, token), [
      MEMBER_KEY,
      `m.p-alice.${Date.now() + 60 * 60_000}.signature`,
    ] as const);

    await page.goto("/players/pack");
    await tearPack(page);
    await page.getByRole("button", { name: /reveal all/i }).click();
    await expect(page.getByText(/pack complete/i)).toBeVisible({ timeout: 30_000 });
    const dealt = (await readPackState(page))!.ids;
    expect(dealt).toHaveLength(PACK_SIZE);

    server.fail("openPack", "a dead spot on the way back");
    await page.reload();
    await expect(sealedPack(page)).toBeHidden();
    const retry = page.getByRole("button", { name: /tap to try again/i });
    await expect(retry).toBeVisible({ timeout: 20_000 });
    expect((await readPackState(page))?.ids).toEqual(dealt);

    server.recover("openPack");
    await retry.click();
    // Straight back to the finished pack: every card was turned before the
    // reload, and the row said so.
    await expect(page.getByText(/pack complete/i)).toBeVisible({ timeout: 30_000 });
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
