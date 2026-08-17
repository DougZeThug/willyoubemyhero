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
  proposerGives: [{ kind: "roster", eventParticipantId: THEM.ep }],
  recipientGives: [{ kind: "roster", eventParticipantId: ME.ep }],
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
    server.set("acceptTradeOffer", { ok: true, tradeId: "t1" });

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
      { id: ME.pid, name: ME.name, nickname: null, hasCode: true, claimed: true },
      { id: THEM.pid, name: THEM.name, nickname: null, hasCode: true, claimed: true },
      // Unclaimed, so it must not appear as a counterparty: an offer to somebody
      // with no device to answer on would sit pending forever.
      { id: PLAYERS[2].pid, name: PLAYERS[2].name, nickname: null, hasCode: false, claimed: false },
    ]);
    // One stub answers for both panels — the handler is the same one either way.
    server.set("getTradeSpares", {
      participantId: ME.pid,
      roster: [{ eventParticipantId: ME.ep, spareCount: 2 }],
      secrets: [{ pullId: PULL_ID, name: "Gary The Grill", artUrl: null, tier: "epic" }],
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
    // go over as the discriminated shape the RPC validates.
    expect(posted[0]).toContain(THEM.pid);
    expect(posted[0]).toContain("secretPullId");
    expect(posted[0]).toContain(PULL_ID);
  });

  test("names no secret card in the public feed", async ({ page, server }) => {
    // The feed is built from the redacted jsonb summary, so there is nothing here
    // to leak — this is the browser-side statement of that, sitting next to the
    // db assertion that the summary carries no secret_card_id.
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

  test("the vault links here", async ({ page, server }) => {
    void server;
    await page.goto("/players");
    const trade = page.getByRole("link", { name: /^trade$/i });
    await expect(trade).toBeVisible();
    await trade.click();
    await expect(page).toHaveTitle(/Trading Post/i);
  });
});
