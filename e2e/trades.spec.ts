// The Trading Post, in a browser.
//
// The swap itself is proved against real Postgres in tests/db/trades.test.ts.
// What is only provable here is the screen: that a signed-out visitor is told
// what to do rather than shown an empty inbox, that accepting sends the offer id
// and nothing else, and that composing an offer posts the two sides the way the
// person built them.
import type { Page } from "@playwright/test";
import { test, expect, PLAYERS } from "./fixtures";

const MEMBER_KEY = "wwbh:member-token";
const ME = PLAYERS[0]; // Alice Ace
const THEM = PLAYERS[1]; // Bob Blitz

const OFFER_ID = "00000000-0000-4000-8000-000000000021";
const PULL_ID = "00000000-0000-4000-8000-000000000031";
const MY_COPY = "00000000-0000-4000-8000-000000000051";
const THEIR_COPY = "00000000-0000-4000-8000-000000000052";

/** A member token this suite's stubs never verify — the server is mocked out. */
const memberToken = (pid: string) => `m.${pid}.${Date.now() + 60 * 60_000}.signature`;

async function signIn(page: Page, pid = ME.pid, name = ME.name) {
  await page.addInitScript(
    ([key, token, who]) => {
      localStorage.setItem(key, token);
      localStorage.setItem("wwbh:member-name", who);
    },
    [MEMBER_KEY, memberToken(pid), name] as const,
  );
}

/** Bob offering his card for Alice's. */
const INBOX_OFFER = {
  id: OFFER_ID,
  status: "pending",
  proposerId: THEM.pid,
  recipientId: ME.pid,
  createdAt: "2026-08-17T10:00:00Z",
  resolvedAt: null,
  // A specific copy each way, with the finish on it — which is what a trade
  // actually moves now.
  proposerGives: [
    { kind: "roster", copyId: THEIR_COPY, eventParticipantId: THEM.ep, edition: "gold" },
  ],
  recipientGives: [
    { kind: "roster", copyId: MY_COPY, eventParticipantId: ME.ep, edition: "standard" },
  ],
};

test.describe("trading post", () => {
  test("tells a signed-out visitor to claim their player", async ({ page, server }) => {
    void server;
    await page.goto("/players/trade");
    await expect(page.getByRole("link", { name: /claim your player/i })).toBeVisible();
    // And offers nothing to press: there is no counterparty picker without a
    // member session, so an unclaimed visitor cannot start composing and then
    // discover they cannot send it.
    await expect(page.getByRole("button", { name: /send offer/i })).toHaveCount(0);
  });

  test("shows an offer waiting on you, naming both sides", async ({ page, server }) => {
    await signIn(page);
    server.set("getMyTradeOffers", { inbox: [INBOX_OFFER], outbox: [], recent: [] });
    await page.goto("/players/trade");

    await expect(page.getByRole("heading", { name: `${THEM.name} → You` })).toBeVisible();
    // The one-line summary is what anyone standing in a garden actually reads.
    await expect(page.getByText("1 card for 1 card")).toBeVisible();
    await expect(page.getByRole("button", { name: "Accept" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Decline" })).toBeVisible();
  });

  test("accepting sends the offer id and nothing else", async ({ page, server }) => {
    await signIn(page);
    server.set("getMyTradeOffers", { inbox: [INBOX_OFFER], outbox: [], recent: [] });
    server.set("acceptTradeOffer", { ok: true, tradeId: "t1", completedCollections: [] });

    // Registered after the auto stub fixture, so this handler runs FIRST and
    // `fallback()` hands the request on to the stub. Kept as raw text rather than
    // parsed: a body this never manages to parse would throw inside a route
    // handler, and a route handler that throws never fulfils — the test would
    // hang somewhere unrelated instead of failing here.
    const posted: string[] = [];
    await page.route("**/_serverFn/**", async (route) => {
      const body = route.request().postData();
      if (body?.includes(OFFER_ID)) posted.push(body);
      await route.fallback();
    });

    await page.goto("/players/trade");
    await page.getByRole("button", { name: "Accept" }).click();

    await expect(page.getByText(/trade done/i)).toBeVisible();
    expect(posted).toHaveLength(1);
    // The recipient is taken from the verified token server-side. The payload
    // carries the offer id alone — the member id travels in a header, and this is
    // the assertion that keeps anybody from "helpfully" adding it to the body.
    expect(posted[0]).toContain(OFFER_ID);
    expect(posted[0]).not.toContain(ME.pid);
  });

  test("explains a voided accept rather than failing silently", async ({ page, server }) => {
    await signIn(page);
    server.set("getMyTradeOffers", { inbox: [INBOX_OFFER], outbox: [], recent: [] });
    server.set("acceptTradeOffer", { ok: false, reason: "voided" });

    await page.goto("/players/trade");
    await page.getByRole("button", { name: "Accept" }).click();
    await expect(page.getByText(/already moved on/i)).toBeVisible();
  });

  test("lets you take your own offer back", async ({ page, server }) => {
    await signIn(page);
    server.set("getMyTradeOffers", {
      inbox: [],
      outbox: [{ ...INBOX_OFFER, proposerId: ME.pid, recipientId: THEM.pid }],
      recent: [],
    });
    server.set("cancelTradeOffer", { ok: true });

    await page.goto("/players/trade");
    await expect(page.getByRole("heading", { name: `You → ${THEM.name}` })).toBeVisible();
    await page.getByRole("button", { name: /take it back/i }).click();
    await expect(page.getByText(/offer pulled/i)).toBeVisible();
  });

  test("composes an offer out of both people's spares", async ({ page, server }) => {
    await signIn(page);
    server.set("getClaimRoster", [
      { id: ME.pid, name: ME.name, nickname: null, hasCode: true, claimed: true, reachable: true },
      {
        id: THEM.pid,
        name: THEM.name,
        nickname: null,
        hasCode: true,
        claimed: true,
        reachable: true,
      },
      // Unclaimed, so it must not appear as a counterparty: an offer to somebody
      // with no device to answer on would sit pending forever.
      {
        id: PLAYERS[2].pid,
        name: PLAYERS[2].name,
        nickname: null,
        hasCode: false,
        claimed: false,
        reachable: false,
      },
    ]);
    // One stub answers for both panels — the handler is the same one either way.
    // Two copies of one card, in different finishes: the thing per-copy trading
    // exists for, and the reason the picker shows two tiles rather than a count.
    server.set("getTradeSpares", {
      participantId: ME.pid,
      roster: [
        { copyId: MY_COPY, eventParticipantId: ME.ep, edition: "platinum" },
        { copyId: THEIR_COPY, eventParticipantId: ME.ep, edition: "standard" },
      ],
      secrets: [
        { pullId: PULL_ID, name: "Gary The Grill", artUrl: null, tier: "epic", lastCopy: true },
      ],
    });
    server.set("createTradeOffer", { ok: true, offerId: OFFER_ID });

    const posted: string[] = [];
    await page.route("**/_serverFn/**", async (route) => {
      const body = route.request().postData();
      if (body?.includes("recipientId")) posted.push(body);
      await route.fallback();
    });

    await page.goto("/players/trade");

    await expect(page.getByRole("button", { name: PLAYERS[2].name })).toHaveCount(0);
    await page.getByRole("button", { name: THEM.name }).click();

    // Nothing staged yet, so there is nothing to send.
    await expect(page.getByRole("button", { name: /send offer/i })).toBeDisabled();

    // One tile from each panel. Both panels render the same stub, so picking the
    // first of each is picking one card from each side.
    await page
      .getByRole("button", { name: new RegExp(ME.name, "i") })
      .first()
      .click();
    await page
      .getByRole("button", { name: /gary the grill/i })
      .last()
      .click();

    const send = page.getByRole("button", { name: /send offer/i });
    await expect(send).toBeEnabled();
    await send.click();

    await expect(page.getByText(new RegExp(`offer sent to ${THEM.name}`, "i"))).toBeVisible();
    expect(posted).toHaveLength(1);
    // The counterparty is the one id a payload legitimately carries; both sides
    // go over as the discriminated shape the RPC validates. A roster item names a
    // COPY, so the finish is decided by which tile was tapped rather than left to
    // the server to guess.
    expect(posted[0]).toContain(THEM.pid);
    expect(posted[0]).toContain("cardCopyId");
    expect(posted[0]).toContain("secretPullId");
    expect(posted[0]).toContain(PULL_ID);
  });

  test("shows each copy of a card separately, by its finish", async ({ page, server }) => {
    // Two Alices, one platinum and one standard. Before card_copies these were a
    // single tile with a spare count, and whichever one you traded arrived
    // standard — so the picker could not have offered this choice at all.
    await signIn(page);
    server.set("getClaimRoster", [
      { id: ME.pid, name: ME.name, nickname: null, hasCode: true, claimed: true, reachable: true },
      {
        id: THEM.pid,
        name: THEM.name,
        nickname: null,
        hasCode: true,
        claimed: true,
        reachable: true,
      },
    ]);
    server.set("getTradeSpares", {
      participantId: ME.pid,
      roster: [
        { copyId: MY_COPY, eventParticipantId: ME.ep, edition: "platinum" },
        { copyId: THEIR_COPY, eventParticipantId: ME.ep, edition: "standard" },
      ],
      secrets: [],
    });

    await page.goto("/players/trade");
    await page.getByRole("button", { name: THEM.name }).click();

    // The rarest finish leads, and only the special one is labelled — a chip
    // reading "Standard" on 70% of copies is noise.
    await expect(page.getByText("Platinum").first()).toBeVisible();
    await expect(page.getByText("Standard")).toHaveCount(0);
  });

  test("marks a secret you only own one of", async ({ page, server }) => {
    // Any secret copy is tradeable now, single or not, so this marker is the only
    // thing between somebody and giving away their only mythic.
    await signIn(page);
    server.set("getClaimRoster", [
      { id: ME.pid, name: ME.name, nickname: null, hasCode: true, claimed: true, reachable: true },
      {
        id: THEM.pid,
        name: THEM.name,
        nickname: null,
        hasCode: true,
        claimed: true,
        reachable: true,
      },
    ]);
    server.set("getTradeSpares", {
      participantId: ME.pid,
      roster: [],
      secrets: [
        { pullId: PULL_ID, name: "Gary The Grill", artUrl: null, tier: "mythic", lastCopy: true },
        { pullId: "p2", name: "The Dog", artUrl: null, tier: "rare", lastCopy: false },
      ],
    });

    await page.goto("/players/trade");
    await page.getByRole("button", { name: THEM.name }).click();

    // Asserted by containment rather than accessible name: the tile is a button
    // wrapping a card image and three lines of caption, and how those concatenate
    // into one name is not something worth pinning a test to.
    const gary = page
      .getByRole("button")
      .filter({ hasText: /gary the grill/i })
      .first();
    await expect(gary).toContainText(/last copy/i);

    const dog = page
      .getByRole("button")
      .filter({ hasText: /the dog/i })
      .first();
    await expect(dog).toBeVisible();
    await expect(dog).not.toContainText(/last copy/i);
  });

  test("falls back to counting a secret the summary could not name", async ({ page, server }) => {
    // The fallback branch, not the rule. The summary DOES name secrets — the
    // league asked to read which one moved — but trades settled before that
    // widening carry `{kind:"secret"}` and nothing else, and they stay in the
    // feed forever. This used to be called "names no secret card in the public
    // feed", which described the world before 20260825000127 and went on passing
    // while 20260825120000 silently reverted the naming in SQL.
    await signIn(page);
    server.set("getTradeFeed", [
      {
        id: "t1",
        proposerId: ME.pid,
        recipientId: THEM.pid,
        proposerGave: [{ kind: "secret" }],
        recipientGave: [{ kind: "roster", eventParticipantId: THEM.ep }],
        executedAt: "2026-08-17T10:00:00Z",
      },
    ]);

    await page.goto("/players/trade");
    await expect(page.getByText(/sent a secret to/i)).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/gary/i);
  });

  test("names the secret that moved, when the summary carries one", async ({ page, server }) => {
    // The browser half of what 20260827130000 restored. The db half is in
    // tests/db/trades.test.ts, against the stored jsonb; this is the statement
    // that the name actually reaches a reader.
    await signIn(page);
    server.set("getTradeFeed", [
      {
        id: "t1",
        proposerId: ME.pid,
        recipientId: THEM.pid,
        proposerGave: [{ kind: "secret", secretCardId: "sc-1", name: "Gary the Grill" }],
        recipientGave: [{ kind: "roster", eventParticipantId: THEM.ep }],
        executedAt: "2026-08-17T10:00:00Z",
      },
    ]);

    await page.goto("/players/trade");
    await expect(page.getByText(/gary the grill/i).first()).toBeVisible();
    // And the nameless wording stays out of the way when there is a name.
    await expect(page.getByText(/sent a secret to/i)).toBeHidden();
  });

  test("the nav links here", async ({ page, server }) => {
    void server;
    await page.goto("/players");
    // Scoped to the nav rather than the page. Exactly one of the two bars is in
    // the accessibility tree at a given width — the other is display:none — so
    // this resolves to one tab in the phone and desktop projects alike.
    const trade = page.getByRole("navigation").getByRole("link", { name: /^trade$/i });
    await expect(trade).toBeVisible();
    await trade.click();
    await expect(page).toHaveTitle(/Trading Post/i);
  });
});
