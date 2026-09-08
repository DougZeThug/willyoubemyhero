// A secret in the pack.
//
// Server functions are stubbed, so what is exercised here is everything the
// browser owns: that a secret takes an ordinary slot on the stand and gets its
// own production there, what survives a reload, what a duplicate and a better
// copy say, and — the point of the whole feature — that the vault shows only
// what you pulled and never hints at what you did not.
import {
  test,
  expect,
  DEFAULT_PACK_IDS,
  LEAGUE_DAY,
  leagueDayAt,
  packResponse,
  rosterSlot,
  SECRET_CARD,
  sealedPack,
  secretSlot,
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

/** Deal a pack with the secret in the middle slot. */
function withSecret(
  server: ServerFnMock,
  over: { slot?: Record<string, unknown>; status?: Record<string, unknown> } = {},
) {
  server.set("getPackStatus", {
    claimed: true,
    day: LEAGUE_DAY,
    openedToday: false,
    secretsOwned: 1,
    resetsAt: `${LEAGUE_DAY}T04:00:00Z`,
    ...(over.status ?? {}),
  });
  server.set(
    "openPack",
    packResponse([rosterSlot("ep-alice"), secretSlot(over.slot ?? {}), rosterSlot("ep-bob")]),
  );
}

/** Today's pack row out of IndexedDB, for the parts of it the server never sees. */
function packRow(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{
        ids: string[];
        cards?: { kind: string; id: string }[];
        revealed: number[];
        pendingCompletions?: number[];
      } | null>((resolve) => {
        const open = indexedDB.open("wwbh-cards", 2);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("pack-state")) return resolve(null);
          const req = db.transaction("pack-state").objectStore("pack-state").get("today");
          req.onsuccess = () => resolve(req.result ?? null);
          req.onerror = () => resolve(null);
        };
        open.onerror = () => resolve(null);
      }),
  );
}

/** Run the whole reveal sequence: the stand turns the cards one at a time without the taps. */
async function revealAll(page: Page) {
  await page.getByRole("button", { name: /reveal all/i }).click();
}

const deals = (server: ServerFnMock) => server.calls.filter((c) => c.includes("openPack")).length;

test.describe("a secret in the pack", () => {
  test("a claimed member gets a secret in its slot, and the row files it as one", async ({
    page,
    server,
  }) => {
    await asMember(page);
    withSecret(server);
    await page.goto("/players/pack");
    await tearPack(page);
    await revealAll(page);

    await expect(page.getByText(/pack complete/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(SECRET_CARD.name).first()).toBeVisible();
    await expect(page.getByText(/secret and all/i)).toBeVisible();

    // The row knows the shape of the pack — which slot was the secret — and the
    // roster ids alone are what `ids` still carries, for the claim and the
    // unrecorded row that name roster cards.
    const state = (await packRow(page))!;
    expect(state.cards?.map((c) => c.kind)).toEqual(["roster", "secret", "roster"]);
    expect(state.ids).toEqual(["ep-alice", "ep-bob"]);
    expect(state.ids).not.toContain(SECRET_CARD.id);
  });

  test("an unclaimed guest gets one too, not a wall", async ({ page, server }) => {
    // Guests are in the garden holding a beer as well, so they get a
    // server-minted identity and whatever the pack holds. What they never get
    // is a gate.
    withSecret(server);
    await page.goto("/players/pack");
    await tearPack(page);
    await revealAll(page);

    await expect(page.getByText(SECRET_CARD.name).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("link", { name: /claim your player/i })).toHaveCount(0);
  });

  test("says nothing about secrets on a pack without one", async ({ page }) => {
    // The default deal: three roster cards. Nothing on the screen may admit
    // that a secret could have been here — an empty slot announces a set.
    await page.goto("/players/pack");
    await tearPack(page);
    await revealAll(page);
    await expect(page.getByText(/pack complete/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/not on the roster/i)).toHaveCount(0);
    await expect(page.getByText(/come back tomorrow/i)).toBeVisible();
  });

  test("re-reads the same pack after a reload rather than dealing again", async ({
    page,
    server,
  }) => {
    await asMember(page);
    withSecret(server);
    await page.goto("/players/pack");
    await tearPack(page);
    await revealAll(page);
    // The whole sequence, not just the secret's turn: the card's accessible
    // name is on it face-down too, so waiting on the name alone reloads
    // mid-peek and tests a resume of a half-turned pack instead.
    await expect(page.getByText(/pack complete/i)).toBeVisible({ timeout: 30_000 });
    const before = deals(server);
    expect(before).toBeGreaterThan(0);

    await page.reload();
    await expect(sealedPack(page)).toBeHidden();
    // A fresh load asks again — a secret's art is signed and expires — and the
    // server answers the same pack. What must not happen is the reveal
    // resetting: every card is still turned, on the finished pack.
    await expect.poll(() => deals(server)).toBeGreaterThan(before);
    await expect(page.getByText(/pack complete/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(SECRET_CARD.name).first()).toBeVisible();
  });

  test("tapping try again after a failed deal actually deals", async ({ page, server }) => {
    await asMember(page);
    withSecret(server);
    server.fail("openPack", "offline");
    await page.goto("/players/pack");
    await tearPack(page);

    const retry = page.getByRole("button", { name: /tap to try again/i });
    await expect(retry).toBeVisible({ timeout: 20_000 });

    server.recover("openPack");
    const before = deals(server);
    await retry.click();

    await expect.poll(() => deals(server)).toBeGreaterThan(before);
    await expect(page.getByTestId("stand-step")).toHaveText("1 / 3", { timeout: 20_000 });
  });

  test("keeps the set-complete ceremony across a reload before the card is turned", async ({
    page,
    server,
  }) => {
    // The most earned moment in the game, and it was being swallowed by a
    // refresh. The deal answers with the completed set at the TEAR, but the
    // ceremony deliberately waits until the secret has been turned over — you
    // see which card it was, and only then that it was the last one. Everything
    // in that gap lived in memory. The row now remembers that a ceremony is
    // owed, and the server repeats which set it was on every replay.
    test.slow();
    await asMember(page);
    withSecret(server, {
      slot: {
        completedCollection: {
          collection: "pets",
          label: "Pets Of The League",
          size: 9,
          completedOn: LEAGUE_DAY,
        },
      },
    });

    await page.goto("/players/pack");
    await tearPack(page);
    // The deal fires off the tear, so by here the completion has landed and been
    // parked against the secret's slot — and the card has not been turned.
    await expect.poll(async () => (await packRow(page))?.pendingCompletions).toEqual([1]);
    const beforeReload = deals(server);

    await page.reload();
    await expect(sealedPack(page)).toBeHidden();
    // Still owed, on a page that has only just asked again.
    await expect.poll(() => deals(server)).toBeGreaterThan(beforeReload);
    expect((await packRow(page))?.pendingCompletions).toEqual([1]);

    await revealAll(page);
    const ceremony = page.getByTestId("collection-complete");
    await expect(ceremony).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Pets Of The League/i).first()).toBeVisible();
    // Once. Two of these on top of each other is one nobody can read, which is
    // what marking the trophy at deal time exists to prevent.
    await expect(ceremony).toHaveCount(1);
    // And the row lets go of it, so tomorrow's reload does not replay it.
    await expect.poll(async () => (await packRow(page))?.pendingCompletions).toBeUndefined();
  });

  test("a duplicate reads as a wink, not a failure", async ({ page, server }) => {
    await asMember(page);
    withSecret(server, {
      slot: { duplicate: true, tierBefore: "common" },
      status: { secretsOwned: 9 },
    });
    await page.goto("/players/pack");
    await tearPack(page);
    await revealAll(page);

    await expect(page.getByText(/already yours/i).first()).toBeVisible({ timeout: 30_000 });
  });

  test("stamps a first pull NEW, secret included", async ({ page, server }) => {
    await asMember(page);
    withSecret(server);
    await page.goto("/players/pack");
    await tearPack(page);
    await revealAll(page);

    await expect(page.getByText(/pack complete/i)).toBeVisible({ timeout: 30_000 });
    // Every card in the pack is a first here — the server says so on each slot.
    await expect(page.getByRole("img", { name: "New card" }).filter({ visible: true })).toHaveCount(3); // prettier-ignore
    await expect(page.getByRole("img", { name: /you now hold/i })).toHaveCount(0);
  });

  test("counts a duplicate secret rather than just winking at it", async ({ page, server }) => {
    await asMember(page);
    withSecret(server, {
      slot: { duplicate: true, tierBefore: "common" },
      status: { secretsOwned: 9 },
    });
    // The number beside the wink. The slot's own `duplicate` flag is the
    // predicate; this is where the count comes from, and the route invalidates
    // it on the deal so it answers with this copy already in it. Three rather
    // than two, deliberately: the route floors a duplicate's count at 2 while
    // this query is still in the air, so stubbing 2 would pass whether or not
    // the count was ever read.
    server.set("getMySecrets", {
      pulled: 1,
      cards: [{ ...SECRET_CARD, firstPulledOn: LEAGUE_DAY, count: 3, ownerCount: 1 }],
    });
    await page.goto("/players/pack");
    await tearPack(page);
    await revealAll(page);

    await expect(page.getByText(/already yours/i).first()).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByRole("img", { name: "You now hold 3 of this card" }).filter({ visible: true }),
    ).toHaveCount(1);
  });

  test("names the rung a better copy climbed to", async ({ page, server }) => {
    // A duplicate that beats the copy you hold is neither a first nor just
    // another one. The ribbon names the NEW rung, in its own metal — for a
    // secret's level and a roster card's finish alike.
    await asMember(page);
    server.set(
      "openPack",
      packResponse([
        rosterSlot("ep-alice", { edition: "gold", heldBefore: 1, editionBefore: "standard" }),
        secretSlot({ duplicate: true, tierBefore: "common", card: { ...SECRET_CARD, tier: "rare" } }), // prettier-ignore
        rosterSlot("ep-bob"),
      ]),
    );
    server.set("getMySecrets", {
      pulled: 1,
      cards: [{ ...SECRET_CARD, tier: "rare", firstPulledOn: LEAGUE_DAY, count: 2, ownerCount: 1 }], // prettier-ignore
    });
    await page.goto("/players/pack");
    await tearPack(page);
    await revealAll(page);

    await expect(page.getByText(/pack complete/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("img", { name: /^Upgraded to Gold/ }).filter({ visible: true })).toHaveCount(1); // prettier-ignore
    await expect(page.getByRole("img", { name: /^Upgraded to Rare/ }).filter({ visible: true })).toHaveCount(1); // prettier-ignore
    // The upgraded secret keeps its level line rather than the wink.
    await expect(page.getByText(/already yours/i)).toHaveCount(0);
  });

  test("the fan gives nothing away, whatever the pack holds", async ({ page, server }) => {
    await asMember(page);
    withSecret(server);
    await page.goto("/players/pack");
    await tearPack(page);

    // Three identical backs. A secret used to fly out wearing the rainbow bezel;
    // now the first the person hears of it is the stand going dark around it.
    await expect(page.locator('[data-testid="opening-card"]')).toHaveCount(3);
    await expect(page.locator('[data-testid="opening-card"] .holo-prism-edge')).toHaveCount(0);
  });

  test("says so when there is nothing to deal, and still offers the way out", async ({
    page,
    server,
  }) => {
    await asMember(page);
    server.set("openPack", { ok: false, reason: "unavailable" });
    await page.goto("/players/pack");
    await tearPack(page);
    await expect(page.getByText(/nothing to deal today/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("link", { name: /view collection/i })).toBeVisible();
  });

  /**
   * Walking onto a secret by hand.
   *
   * By hand rather than through "Reveal all", because the automatic run turns
   * cards without the taps and this is about what a thumb sees: the secret is
   * an ordinary step in the sequence, and the card in its slot wears the ring,
   * says what it is, and turns into itself.
   */
  test("steps onto a secret in the middle of the pack like any other card", async ({
    page,
    server,
  }) => {
    await asMember(page);
    withSecret(server);
    // Both, not just the status: the nav asks for the day's status on every
    // screen now, so that answer can land before the route has even asked for
    // the event.
    const ready = Promise.all(
      ["getPackStatus", "getEventBundle"].map((fn) =>
        page.waitForResponse(
          (r) => r.url().includes("/_serverFn/") && serverFnName(r.url()).includes(fn),
        ),
      ),
    );
    await page.goto("/players/pack");
    await ready;
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

    /**
     * Turn the card on the stand, pressing until it takes.
     *
     * One tap is not enough on a loaded runner. `revealAt` holds its re-entrancy
     * latch for the whole of the previous card's celebration, so a tap that
     * lands while confetti is still in the air is swallowed on purpose. The hint
     * is the signal: the stand's own copy is "tap for the back" once a card has
     * turned, so `aria-pressed` — which tracks that flip — is only good enough
     * to say "not currently showing its back".
     */
    const hint = page.getByText(/swipe/i).first();
    async function turnCard() {
      await expect
        .poll(
          async () => {
            if (await hint.count()) return true;
            if ((await card.getAttribute("aria-pressed")) === "false") await card.click();
            await page.waitForTimeout(400);
            return (await hint.count()) > 0;
          },
          { timeout: 25_000, intervals: [200] },
        )
        .toBe(true);
    }

    await turnCard();
    await swipeNext();

    // The secret's step: an ordinary position in the heading, the ring on the
    // card, and the one line that says what it is — before it is turned.
    await expect(step).toHaveText("2 / 3");
    await expect(page.locator(".secret-seal")).toHaveCount(1);
    await expect(page.getByText(/not on the roster/i).first()).toBeVisible();
    await turnCard();
    await expect(page.getByText(SECRET_CARD.name).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".secret-seal")).toHaveCount(0);

    // And on past it, to the last roster card, with nothing owed after that.
    await swipeNext();
    await expect(step).toHaveText("3 / 3");
    await turnCard();
    await swipeNext();
    await expect(page.getByText(/pack complete/i)).toBeVisible({ timeout: 15_000 });
    expect((await packRow(page))?.ids).toEqual(["ep-alice", "ep-bob"]);
  });
});

test.describe("the vault's secret shelf", () => {
  test("shows what you pulled, with no total and no empty slots", async ({ page, server }) => {
    await asMember(page);
    // Filed into a real set rather than left on the unsorted pile, because the one
    // marker this page is allowed — see below — only ever appears on a set.
    server.set("getSecretCollections", {
      collections: [{ id: "pets", label: "Pets", accent: "mint" }],
    });
    server.set("getMySecrets", {
      pulled: 3,
      cards: [
        {
          ...SECRET_CARD,
          collection: "pets",
          firstPulledOn: "2026-07-28",
          count: 1,
          ownerCount: 3,
        },
        {
          ...SECRET_CARD,
          id: "secret-gazebo",
          name: "The Gazebo",
          collection: "pets",
          firstPulledOn: "2026-07-27",
          count: 2,
          ownerCount: 1,
        },
      ],
    });
    await page.goto("/players");

    // The counter stack became one summary line under the Today card (§13).
    // "across 1 set" is how many sets these came FROM — never how many exist.
    await expect(page.getByText(/Secrets 3 across 1 set/)).toBeVisible();
    await expect(page.getByText(SECRET_CARD.name).first()).toBeVisible();
    await expect(page.getByText("Pulled ×2")).toBeVisible();

    // A count of PEOPLE is allowed and is stated here deliberately, so the
    // distinction below is a rule rather than an accident.
    await expect(page.getByText(/packed by 3/i)).toBeVisible();

    // The one marker the page is allowed, and only in this exact shape: ONE tile
    // at the end of an open set, whatever is left in it. Two of them would be a
    // count of what is missing; a number on it would be the set size outright.
    await expect(page.getByText("More in this set")).toHaveCount(1);
    await expect(page.getByRole("img", { name: "Unknown cards remain" })).toHaveCount(1);

    // The load-bearing assertion: nowhere on this page is there a denominator, a
    // silhouette, or a "???" slot. An unpulled secret is not missing — it is
    // unknown, and the page must not admit it exists. The marker above says a set
    // is unfinished and nothing whatsoever about by how much, which is why it can
    // sit inside these three.
    const body = page.locator("body");
    await expect(body).not.toContainText(/of \d+ secrets/i);
    await expect(body).not.toContainText(/\?\?\?/);
    await expect(body).not.toContainText(/\d+ \/ \d+ secrets/i);
  });

  test("drops the marker once the set is finished", async ({ page, server }) => {
    // Completion is the one moment the size is known, and the plaque already says
    // it. A horizon after that would be pointing past the end of the shelf.
    await asMember(page);
    server.set("getSecretCollections", {
      collections: [{ id: "pets", label: "Pets", accent: "mint" }],
    });
    server.set("getMySecrets", {
      pulled: 1,
      cards: [
        {
          ...SECRET_CARD,
          collection: "pets",
          firstPulledOn: "2026-07-28",
          count: 1,
          ownerCount: 3,
        },
      ],
    });
    server.set("getCollectionTrophies", {
      trophies: [
        {
          participantId: "p-alice",
          collection: "pets",
          label: "Pets",
          size: 1,
          completedOn: "2026-07-28",
          via: "pull",
        },
      ],
    });
    await page.goto("/players");

    await expect(page.getByRole("heading", { level: 2, name: "Complete" })).toBeVisible();
    await expect(page.getByText("More in this set")).toHaveCount(0);
  });

  test("keeps the trophy case above the sets it is the answer to", async ({ page, server }) => {
    // The default shelf order, on the only surface that can actually see it.
    // The unit test next door pins the merge; this pins the decision (§13).
    await asMember(page);
    server.set("getMySecrets", {
      pulled: 1,
      cards: [{ ...SECRET_CARD, firstPulledOn: "2026-07-28", count: 1, ownerCount: 1 }],
    });
    server.set("getCollectionTrophies", {
      trophies: [
        {
          participantId: "p-alice",
          collection: "pets",
          label: "Legacy Pets",
          size: 4,
          completedOn: "2026-07-28",
          via: "pull",
        },
      ],
    });
    await page.goto("/players");

    const headings = page.getByRole("heading", { level: 2 });
    await expect(headings.filter({ hasText: "Complete" })).toBeVisible();
    const order = await headings.allTextContents();
    expect(order.indexOf("Complete")).toBeLessThan(order.indexOf("Secrets"));
    // And the roster last, so the sets you are collecting lead the page.
    expect(order.indexOf("Roster")).toBe(order.length - 1);
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

  test("puts a cue on the pack button while today's pack is unopened", async ({ page, server }) => {
    await asMember(page);
    server.set("getPackStatus", {
      claimed: true,
      day: LEAGUE_DAY,
      openedToday: false,
      secretsOwned: 1,
      resetsAt: `${LEAGUE_DAY}T04:00:00Z`,
    });
    await page.goto("/players");
    // Scoped to the page: the nav's Pack tab wears the same cue, so an unscoped
    // match finds two.
    const hero = page.getByRole("main").getByRole("link", { name: /^open today's pack$/i });
    await expect(hero).toBeVisible();
    await expect(hero.getByTestId("pack-waiting-dot")).toBeVisible();
  });

  test("leaves the pack button alone once it is opened", async ({ page, server }) => {
    await asMember(page);
    server.set("getPackStatus", {
      claimed: true,
      day: LEAGUE_DAY,
      openedToday: true,
      secretsOwned: 2,
      resetsAt: `${LEAGUE_DAY}T04:00:00Z`,
    });
    await page.goto("/players");
    const hero = page.getByRole("main").getByRole("link", { name: /^open today's pack$/i });
    await expect(hero).toBeVisible();
    await expect(hero.getByTestId("pack-waiting-dot")).toHaveCount(0);
  });
});

/**
 * The Today card's three states, in a browser.
 *
 * The pack row is seeded straight into IndexedDB from an init script — the same
 * trick the pack journeys use — because that row IS the state: the vault only
 * ever reads it, and there is no other way to arrive on a half-open pack without
 * playing one through.
 */
test.describe("the vault's Today card", () => {
  /** Write a pack row for today, as this device. */
  async function seedPack(page: Page, revealed: number[]) {
    await page.addInitScript(
      ([turned, dayKey, ids]) => {
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
            .put(
              {
                dayKey,
                ids,
                cards: (ids as string[]).map((id) => ({ kind: "roster", id })),
                revealed: turned,
                cursor: (turned as number[]).length,
                // No identity, which counts as this device's — the row shape a
                // pack written before per-person packs has, and the one an init
                // script can write without knowing the minted device id.
              },
              "today",
            );
        };
      },
      // The league day, computed here with the same formula the app uses: the
      // row is keyed on it, and a device-local date would be yesterday's or
      // tomorrow's for part of every day.
      [revealed, leagueDayAt(new Date()), DEFAULT_PACK_IDS] as const,
    );
  }

  test("offers the pack while it is still sealed", async ({ page }) => {
    await page.goto("/players");
    await expect(
      page.getByRole("main").getByRole("link", { name: /^open today's pack$/i }),
    ).toBeVisible();
  });

  test("asks somebody to finish a pack they walked away from", async ({ page }) => {
    await seedPack(page, [0]);
    await page.goto("/players");
    await expect(page.getByRole("link", { name: "Finish your pack · 2 cards left" })).toBeVisible();
  });

  test("counts down to the next one once today's is spent", async ({ page, server }) => {
    // A day that resets far enough ahead that the countdown is stable however
    // long the run takes.
    server.set("getPackStatus", {
      claimed: true,
      day: LEAGUE_DAY,
      openedToday: true,
      secretsOwned: 1,
      resetsAt: new Date(Date.now() + 6 * 3_600_000).toISOString(),
    });
    await seedPack(page, [0, 1, 2]);
    await page.goto("/players");
    await expect(page.getByText(/^next pack in \d+h$/i)).toBeVisible();
    // And no pack control at all: the Pack tab is one tap away, so a second
    // route to the same screen here would be the nav drawn twice.
    await expect(
      page.getByRole("main").getByRole("link", { name: /open today's pack/i }),
    ).toHaveCount(0);
  });

  test("draws the streak ladder and claims a rung without leaving home", async ({
    page,
    server,
  }) => {
    await asMember(page);
    server.set("getStreakStatus", {
      kind: "member",
      current: 3,
      startedOn: "2026-07-26",
      lastOpenedOn: "2026-07-28",
      openedToday: true,
      today: "2026-07-28",
      canClaim: true,
      milestones: [
        { days: 3, label: "Three Days", blurb: "A bonus secret, on the house.", tierFloor: null, earned: true, claimed: false }, // prettier-ignore
        { days: 7, label: "One Week", blurb: "Seven days straight. Rare or better.", tierFloor: "rare", earned: false, claimed: false }, // prettier-ignore
      ],
    });
    // Deliberately absent from DEFAULT_RESPONSES, so nothing reaches the payout
    // unless a test means it to.
    server.set("claimStreakMilestone", {
      ok: true,
      milestone: 3,
      streak: 3,
      startedOn: "2026-07-26",
      duplicate: false,
      card: SECRET_CARD,
    });

    await page.goto("/players");
    await expect(page.getByText("Day 3")).toBeVisible();
    await page.getByRole("button", { name: "Claim Three Days" }).click();
    // The same ceremony the pack summary opens, from a surface the stand is long
    // gone from.
    await expect(page.getByTestId("milestone-reveal")).toBeVisible({ timeout: 20_000 });
  });
});
