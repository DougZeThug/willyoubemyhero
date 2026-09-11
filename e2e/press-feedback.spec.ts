// Press feedback on a touch screen (§23 F11).
//
// Tailwind v4 compiles every `hover:` utility inside `@media (hover: hover)`, so
// until styles.css's `@custom-variant hover` promoted them a thumb reached none
// of them: roughly a
// hundred controls changed nothing between touch-down and the screen moving on.
// This file is the proof that they do now, and — the half that is easy to lose —
// that none of them stays changed once the finger comes off.
//
// Two things about the instrument are worth knowing before reading it:
//
//  1. It compares computed style STRINGS and never reads a colour. Chromium hands
//     `oklch()` and `color-mix()` back unresolved, which is the trap
//     control-edges.spec.ts documents at :11 and pays for with a canvas readback.
//     Nothing here asks what colour anything is, only whether it is the same
//     string as a moment ago — so this spec can live on the phone project, where
//     the coarse pointer actually is, rather than on the desktop one.
//  2. It releases the press with the pointer still ON the control, and checks
//     the style comes back. Clicks are swallowed so a Link can be held and
//     released without navigating out from under that check.
//
// What this file deliberately does NOT prove is the other half of §23 F11 — that
// no hand-written `:hover` is left to latch. Chromium under touch emulation never
// applies `:hover` at all, so an ungated rule reads here exactly like a gated
// one: measured on a phone, the latch is invisible until a real phone shows it.
// src/styles.test.ts answers that half at the source instead, by walking the
// sheet for a `:hover` outside a `(hover: hover)` query. Two halves, two
// instruments, because neither can see what the other is looking at.
import type { Locator, Page } from "@playwright/test";
import { test, expect, PLAYERS, type ServerFnMock } from "./fixtures";

const ME = PLAYERS[0];
const MEMBER_KEY = "wwbh:member-token";

/**
 * Everything a promoted hover in this app can move. `scale` is separate from
 * `transform` in Tailwind v4 — `hover:scale-[1.02]` compiles to `scale:1.02` —
 * and `textDecorationLine` is the only thing fifteen of the links change.
 */
const WATCHED = [
  "color",
  "backgroundColor",
  "borderTopColor",
  "borderBottomColor",
  "textDecorationLine",
  "opacity",
  "transform",
  "scale",
  "boxShadow",
  "filter",
] as const;

const styleOf = (el: Locator) =>
  el.evaluate(
    (node, props) =>
      props
        .map((p) => getComputedStyle(node as Element)[p as keyof CSSStyleDeclaration])
        .join(" | "),
    WATCHED as unknown as string[],
  );

/**
 * Polls rather than reading once: `transition-colors` is 150ms, so a single read
 * after the press races the transition it is trying to observe. Returns the last
 * value seen either way — the caller decides whether that is a finding, because
 * throwing here would lose the other offenders on the same screen.
 */
async function settle(el: Locator, done: (s: string) => boolean, budget = 1500) {
  const deadline = Date.now() + budget;
  let last = await styleOf(el);
  while (!done(last) && Date.now() < deadline) {
    await el.page().waitForTimeout(25);
    last = await styleOf(el);
  }
  return last;
}

const UNDER_TEST = "data-press-under-test";

/** Hold, watch, release, watch. Findings go in `out`; nothing throws. */
async function pressAndRelease(target: Locator, label: string, out: string[]) {
  const page = target.page();
  try {
    // Retrying, because half these screens fill in from a server function after
    // the heading lands and a bare isVisible() would call that "not there".
    await target.waitFor({ state: "visible", timeout: 10_000 });
  } catch (err) {
    // The first line, not a fixed sentence: a locator that matched two elements
    // and a locator that matched none both land here, and reporting both as
    // "never arrived" sends the reader looking for the wrong bug. `name:` is
    // substring-matched, and the viewer's own card is labelled "…press to flip".
    return void out.push(`${label}: ${String((err as Error).message).split("\n")[0]}`);
  }
  if (!(await target.isEnabled())) {
    // `:active` never matches a disabled control, so measuring one passes for
    // the wrong reason. Arrange it into its enabled branch instead.
    return void out.push(`${label}: disabled, so a press could not reach it`);
  }
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) return void out.push(`${label}: no box to press`);

  // Marked, then watched through the mark rather than through the name it was
  // found by. A Radix trigger opens its menu on POINTERDOWN and Radix hides the
  // rest of the page from the accessibility tree while it is open — so a
  // role-based locator stops resolving the instant the press it is measuring
  // lands on it, and the measurement times out on the one control it was most
  // worth taking.
  await target.evaluate((node, attr) => node.setAttribute(attr, ""), UNDER_TEST);
  const el = page.locator(`[${UNDER_TEST}]`);
  try {
    const rest = await styleOf(el);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    const held = await settle(el, (s) => s !== rest);
    await page.mouse.up();
    const after = await settle(el, (s) => s === rest);

    if (held === rest) out.push(`${label}: nothing changed while it was held — ${rest}`);
    else if (after !== rest) out.push(`${label}: kept ${after} after release (rest is ${rest})`);
  } finally {
    await el.evaluate((node, attr) => node.removeAttribute(attr), UNDER_TEST);
    // Anything the press opened is closed again, or it covers the next target.
    const menu = page.locator('[role="menu"]');
    if (await menu.first().isVisible()) await page.keyboard.press("Escape");
  }
}

const PRESS_HINT =
  "A promoted hover only reaches something the browser activates: check it is a " +
  "real <button> or <a>, that it is not disabled, and that its treatment is a " +
  "hover: utility rather than a hand-written :hover rule in styles.css — those " +
  "are gated one at a time, and an ungated one latches instead of pressing.";

/** A member token these stubs never verify — the server is mocked out. */
async function signInAsMember(page: Page) {
  await page.addInitScript(
    ([key, token, who]) => {
      localStorage.setItem(key, token);
      localStorage.setItem("wwbh:member-name", who);
    },
    [MEMBER_KEY, `m.${ME.pid}.${Date.now() + 60 * 60_000}.signature`, ME.name] as const,
  );
}

/** Alice packed, so the card page's chips are live rather than face-down. */
const OWNS_ALICE = {
  cards: [
    {
      eventParticipantId: ME.ep,
      pullCount: 1,
      edition: "gold",
      firstPulledAt: "2026-07-28T10:00:00Z",
    },
  ],
  packsOpened: 1,
  firstPackOn: "2026-07-28",
};

const OFFER = {
  id: "00000000-0000-4000-8000-0000000000d1",
  status: "pending",
  proposerId: PLAYERS[1].pid,
  recipientId: ME.pid,
  createdAt: "2026-08-17T10:00:00Z",
  resolvedAt: null,
  proposerGives: [
    {
      kind: "roster",
      copyId: "00000000-0000-4000-8000-0000000000d2",
      eventParticipantId: PLAYERS[1].ep,
      edition: "gold",
    },
  ],
  recipientGives: [
    {
      kind: "roster",
      copyId: "00000000-0000-4000-8000-0000000000d3",
      eventParticipantId: ME.ep,
      edition: "standard",
    },
  ],
};

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "mobile",
    "A press is a coarse-pointer finding; the desktop project has a hover to use.",
  );
  // Registered before hydration and on the window's capture phase, so it runs
  // ahead of React's delegated listener whichever node that is attached to.
  // Every target here is a Link or a submit button, and letting the click through
  // would navigate or post out from under the release assertion.
  await page.addInitScript(() => {
    addEventListener(
      "click",
      (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
      },
      true,
    );
  });
});

/**
 * Proves the two facts the whole change rests on, in a browser, without needing
 * any of the app state that carries them.
 *
 * Redefining the built-in `hover` variant keeps its cascade position upstream, so
 * an explicit `active:` utility still outranks the promoted one. That matters
 * once: players.index.tsx's trophy tile pairs `hover:scale-[1.02]` with
 * `active:scale-[0.99]`, and getting it wrong means a pressed tile GROWS. The
 * pair is asserted against a control carrying only the `active:` half, so the
 * test cannot pass by both being inert — the "changed at all" check above it is
 * what closes that door.
 *
 * The probes carry only classes that already exist in src/, because Tailwind
 * scans `@source "../src"` and never sees this file. No transition class on
 * purpose: the point is which value wins, not how long it takes to arrive.
 */
test("an explicit active: still outranks the hover it was promoted alongside", async ({ page }) => {
  await page.goto("/players");
  await expect(page.getByRole("button", { name: /sort and filter/i })).toBeVisible();

  await page.evaluate(() => {
    const probes: [string, string][] = [
      ["probe-scale-pair", "hover:scale-[1.02] active:scale-[0.99]"],
      ["probe-scale-only", "active:scale-[0.99]"],
      ["probe-bg-pair", "hover:bg-primary/20 active:bg-primary/25"],
      ["probe-bg-only", "active:bg-primary/25"],
    ];
    probes.forEach(([id, cls], i) => {
      const el = document.createElement("button");
      el.type = "button";
      el.id = id;
      el.className = cls;
      el.textContent = id;
      el.style.cssText = `position:fixed;left:0;top:${i * 48}px;width:140px;height:44px;z-index:9999`;
      document.body.append(el);
    });

    const link = document.createElement("a");
    link.href = "#probe";
    link.id = "probe-group";
    link.className = "group";
    link.style.cssText = "position:fixed;left:0;top:192px;width:140px;height:44px;z-index:9999";
    const span = document.createElement("span");
    span.id = "probe-group-child";
    span.className = "group-hover:text-primary";
    span.textContent = "grouped";
    link.append(span);
    document.body.append(link);
  });

  const offenders: string[] = [];
  for (const [pair, only, what] of [
    ["#probe-scale-pair", "#probe-scale-only", "scale"],
    ["#probe-bg-pair", "#probe-bg-only", "background"],
  ] as const) {
    const a = page.locator(pair);
    const b = page.locator(only);
    await pressAndRelease(a, `${what} pair`, offenders);

    const bBox = (await b.boundingBox())!;
    const aBox = (await a.boundingBox())!;
    await page.mouse.move(bBox.x + 4, bBox.y + 4);
    await page.mouse.down();
    const wanted = await styleOf(b);
    await page.mouse.up();
    await page.mouse.move(aBox.x + 4, aBox.y + 4);
    await page.mouse.down();
    const got = await settle(a, (s) => s === wanted);
    await page.mouse.up();

    if (got !== wanted) {
      offenders.push(
        `${what}: a pressed control with both hover: and active: settled on ` +
          `${got}, where the active: half alone gives ${wanted}. The promoted ` +
          `hover is outranking the press it should be losing to.`,
      );
    }
  }

  // The compound half: `group-hover:` has to promote too, or new-since-strip's
  // caption is invisible to the whole change.
  const group = page.locator("#probe-group");
  const child = page.locator("#probe-group-child");
  const childRest = await styleOf(child);
  const gBox = (await group.boundingBox())!;
  await page.mouse.move(gBox.x + 4, gBox.y + 4);
  await page.mouse.down();
  const childHeld = await settle(child, (s) => s !== childRest);
  await page.mouse.up();
  const childAfter = await settle(child, (s) => s === childRest);
  if (childHeld === childRest) {
    offenders.push("group-hover: did not promote — pressing the group moved nothing inside it");
  } else if (childAfter !== childRest) {
    offenders.push(`group-hover: kept ${childAfter} after release`);
  }

  expect(
    offenders,
    `The @custom-variant hover in styles.css is not landing as intended.\n${PRESS_HINT}`,
  ).toEqual([]);
});

type Sweep = {
  name: string;
  member?: true;
  arrange?: (server: ServerFnMock) => void;
  /** Where to go and how to know the screen is really there. */
  open: (page: Page) => Promise<void>;
  /** The controls, by the name a person would call them. */
  targets: (page: Page) => Record<string, Locator>;
};

const SWEEPS: Sweep[] = [
  {
    name: "the vault",
    open: async (page) => {
      await page.goto("/players");
      await expect(page.getByRole("button", { name: /sort and filter/i })).toBeVisible();
    },
    targets: (page) => ({
      // vault-sort-sheet.tsx:178 — hover:bg-white/5 hover:text-foreground
      "sort & filter": page.getByRole("button", { name: /sort and filter/i }),
      // vault-hero.tsx:91 — hover:underline, plus styles.css's brightness step,
      // which is the only reason this one reads under a thumb at all.
      "claim your player": page.getByRole("link", { name: /claim your player/i }),
      // site-nav.tsx:180 — the bar has no hover: to promote and carries its own
      // active: fill. Scoped to the nav, because the desktop row is hidden here
      // and a bare name match would find the wrong link on a wider viewport.
      "vault tab": page.getByRole("navigation").getByRole("link", { name: /^vault$/i }),
      // site-nav.tsx:264 — hover:text-primary
      "profile icon": page.getByRole("link", { name: "You", exact: true }),
    }),
  },
  {
    name: "a card page",
    member: true,
    arrange: (server) => server.set("getMyCardStats", OWNS_ALICE),
    open: async (page) => {
      await page.goto(`/players/${ME.ep}`);
      await expect(page.getByRole("heading", { name: ME.name })).toBeVisible();
      // The Post button is dead until the box has something in it, and a dead
      // control cannot show a press.
      await page.getByPlaceholder(/talk your talk/i).fill("pressed");
    },
    targets: (page) => ({
      // players.$id.tsx:1101 — .tier-chip, the one hand-written hover in the app
      // that used to latch. Compare rather than Flip: Flip's own label changes
      // on press, which would read as feedback whether or not the CSS moved.
      "compare chip": page.getByRole("button", { name: /^compare$/i }),
      // players.$id.tsx:874 — the same class on the phone's overflow trigger
      "more actions chip": page.getByRole("button", { name: "More actions" }).first(),
      // card-social.tsx:359 — hover:bg-primary/20
      post: page.getByRole("button", { name: "Post" }),
      // roster-filmstrip.tsx:86 — hover:opacity-80, on an inactive cell only
      "filmstrip cell": page.getByRole("button", { name: `Show ${PLAYERS[1].name}` }),
    }),
  },
  {
    name: "the card viewer",
    member: true,
    arrange: (server) => server.set("getMyCardStats", OWNS_ALICE),
    open: async (page) => {
      await page.goto(`/players/${ME.ep}?view=1`);
      await expect(page.getByTestId("card-viewer")).toBeVisible();
    },
    targets: (page) => {
      const viewer = page.getByTestId("card-viewer");
      return {
        // card-viewer.tsx:387, :401, :438 — the three the audit named, plus the
        // Close beside them, whose hover lives in ViewerButton at :505 and would
        // otherwise be the one button in the row nobody checked.
        flip: viewer.getByRole("button", { name: "Flip", exact: true }),
        "more actions": viewer.getByRole("button", { name: "More actions", exact: true }),
        details: viewer.getByRole("button", { name: /^details$/i }),
        close: viewer.getByRole("button", { name: "Close", exact: true }),
      };
    },
  },
  {
    name: "the trading post",
    member: true,
    arrange: (server) =>
      server.set("getMyTradeOffers", {
        inbox: [OFFER],
        outbox: [
          {
            ...OFFER,
            id: `${OFFER.id.slice(0, -1)}9`,
            proposerId: ME.pid,
            recipientId: PLAYERS[1].pid,
          },
        ],
        recent: [],
      }),
    open: async (page) => {
      await page.goto("/players/trade");
      await expect(page.getByRole("heading", { name: "Trading Post" })).toBeVisible();
      // The heading is on the empty screen too, so it would let this measure an
      // inbox that had not arrived yet and report the buttons as missing.
      await expect(page.getByRole("button", { name: "Accept" })).toBeVisible();
    },
    targets: (page) => ({
      // trade-offers.tsx:122 and :160. Both sit beside a neon-btn that has had a
      // press since long before this change; these are the quiet halves that did
      // not.
      decline: page.getByRole("button", { name: "Decline" }).first(),
      "take it back": page.getByRole("button", { name: /take it back/i }).first(),
    }),
  },
];

test.describe("every named control answers a thumb", () => {
  for (const sweep of SWEEPS) {
    test(`${sweep.name} moves under a held press and lets go after it`, async ({
      page,
      server,
    }) => {
      sweep.arrange?.(server);
      if (sweep.member) await signInAsMember(page);
      await sweep.open(page);

      // The rule these controls hang off is keyed on the query, not on a width,
      // so prove the query is true here before measuring anything — otherwise a
      // change to the device preset turns the whole file into a tautology.
      expect(await page.evaluate(() => matchMedia("(hover: none)").matches)).toBe(true);
      expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);

      const offenders: string[] = [];
      for (const [label, el] of Object.entries(sweep.targets(page))) {
        await pressAndRelease(el, label, offenders);
      }

      // One assertion over the screen rather than one per control: a throw on the
      // first would say nothing about the other five.
      expect(
        offenders,
        `Controls on ${sweep.name} that a thumb cannot feel.\n${PRESS_HINT}`,
      ).toEqual([]);
    });
  }
});

/**
 * The desktop section row is `hidden md:flex`, so it does not exist at 390px —
 * and a phone turned sideways is 844px wide with the thumb still the input. Same
 * argument smoke.spec.ts:623 makes for the tap-target floor, and the same reason
 * this row cannot be left to the sweeps above.
 */
test("the wide nav row presses on a landscape phone", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  expect(await page.evaluate(() => matchMedia("(hover: none)").matches)).toBe(true);

  await page.goto("/players");
  await expect(page.getByRole("button", { name: /sort and filter/i })).toBeVisible();

  const offenders: string[] = [];
  const row = page.getByRole("navigation", { name: "Sections" });
  await pressAndRelease(row.getByRole("link", { name: /^pack$/i }), "sections: pack", offenders);

  expect(offenders, `The wide navigation row at 844px.\n${PRESS_HINT}`).toEqual([]);
});
