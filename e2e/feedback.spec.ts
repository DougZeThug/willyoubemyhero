// Where the app says things, and where it stops saying them.
//
// Four surfaces that only exist as pixels — a placeholder that has to be on
// screen before the data is, a toast that has to clear the tab bar, a banner
// that only appears when the network goes away, and the page nobody means to
// land on. None of them is provable from a unit test: three are about layout in
// a real viewport and the fourth needs a router that actually fails to match.
//
// docs/ux-audit-mobile.md §19 and §21.
import type { Page } from "@playwright/test";
import { expect, test, PLAYERS } from "./fixtures";

const MEMBER_KEY = "wwbh:member-token";
const ME = PLAYERS[0]; // Alice Ace
const THEM = PLAYERS[1]; // Bob Blitz

const OFFER_ID = "00000000-0000-4000-8000-000000000021";
const MY_COPY = "00000000-0000-4000-8000-000000000051";
const THEIR_COPY = "00000000-0000-4000-8000-000000000052";

/**
 * How light a computed colour is, 0..1.
 *
 * Colours in this app are `oklch()` and Chromium hands them straight back that
 * way, so the first component IS the answer. The sRGB branch is only there so a
 * future Chromium that resolves them does not turn this into a false pass — the
 * old version of this check parsed an oklch() hue as a blue channel and passed
 * whatever it was given.
 */
function lightness(colour: string): number {
  const oklch = /^oklch\(\s*([\d.]+)(%?)/.exec(colour);
  if (oklch) return oklch[2] ? Number(oklch[1]) / 100 : Number(oklch[1]);
  const [r, g, b] = (colour.match(/[\d.]+/g) ?? []).map(Number);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

async function signIn(page: Page) {
  await page.addInitScript(
    ([key, token, who]) => {
      localStorage.setItem(key, token);
      localStorage.setItem("wwbh:member-name", who);
    },
    [MEMBER_KEY, `m.${ME.pid}.${Date.now() + 60 * 60_000}.signature`, ME.name] as const,
  );
}

/** Bob's gold card for Alice's standard one, waiting on her. */
const INBOX_OFFER = {
  id: OFFER_ID,
  status: "pending",
  proposerId: THEM.pid,
  recipientId: ME.pid,
  createdAt: "2026-08-17T10:00:00Z",
  resolvedAt: null,
  proposerGives: [
    { kind: "roster", copyId: THEIR_COPY, eventParticipantId: THEM.ep, edition: "gold" },
  ],
  recipientGives: [
    { kind: "roster", copyId: MY_COPY, eventParticipantId: ME.ep, edition: "standard" },
  ],
};

test.describe("waiting", () => {
  test("draws card-shaped placeholders until the collection has been counted", async ({
    page,
    server,
  }) => {
    // The collection query is what every slot on this screen waits on, and it is
    // the one held back here. Before this, the shelf painted every card
    // face-down and popped the owned ones open the moment the answer landed —
    // a reveal in the wrong place, for free, on the screen the app opens to.
    await signIn(page);
    server.delay("getMyCardStats", 2000);
    await page.goto("/players");

    const skeletons = page.getByTestId("card-skeleton");
    await expect(skeletons.first()).toBeVisible();
    // One per roster row, so the shelf is the size it is about to be.
    await expect(skeletons).toHaveCount(PLAYERS.length);
    // And no card at all yet — not a face-down one either.
    await expect(page.getByRole("img", { name: /Alice Ace/ })).toHaveCount(0);

    // Then the real shelf, in the same boxes.
    await expect(page.getByRole("img", { name: /Alice Ace — not packed yet/ })).toBeVisible();
    await expect(skeletons).toHaveCount(0);
  });
});

test.describe("toasts", () => {
  test("lands above the tab bar rather than under a thumb", async ({ page, server }, info) => {
    test.skip(info.project.name !== "mobile", "the bottom bar is the phone's bar");
    await signIn(page);
    server.set("getMyTradeOffers", { inbox: [INBOX_OFFER], outbox: [], recent: [] });
    server.set("declineTradeOffer", { ok: true });
    await page.goto("/players/trade");

    await page.getByRole("button", { name: "Decline" }).click();

    const toast = page.locator("[data-sonner-toast]").first();
    const nav = page.locator('nav[aria-label="Primary"]');
    await expect(toast).toBeVisible();

    // Polled, because a toast slides up into its slot: measured on the frame it
    // appears, its box is still down where it started. Clear of the bar
    // entirely rather than merely starting above it — a toast whose bottom edge
    // overlaps the tabs is one you dismiss by mistapping Trade.
    await expect
      .poll(
        async () => {
          const t = await toast.boundingBox();
          const n = await nav.boundingBox();
          return t && n ? Math.round(n.y - (t.y + t.height)) : -1;
        },
        { message: "gap between the bottom of the toast and the top of the tab bar" },
      )
      .toBeGreaterThanOrEqual(0);
  });

  test("offers to put a declined offer back", async ({ page, server }) => {
    // The one reversible answer in the app: declining moves no card, so undoing
    // it is a status flip. reopen_trade_offer decides whether it is allowed —
    // what this proves is that the button is offered and reaches the handler.
    await signIn(page);
    server.set("getMyTradeOffers", { inbox: [INBOX_OFFER], outbox: [], recent: [] });
    server.set("declineTradeOffer", { ok: true });
    server.set("reopenTradeOffer", { ok: true, counterpartyId: THEM.pid });
    await page.goto("/players/trade");

    await page.getByRole("button", { name: "Decline" }).click();
    await page.getByRole("button", { name: "Undo" }).click();

    await expect(page.getByText("Offer's back")).toBeVisible();
    expect(server.calls).toContain("reopenTradeOffer_createServerFn_handler");
  });
});

test.describe("offline", () => {
  test("says so, and takes the buttons that cannot work with it", async ({ page, server }) => {
    await signIn(page);
    server.set("getMyTradeOffers", { inbox: [INBOX_OFFER], outbox: [], recent: [] });
    await page.goto("/players/trade");

    const accept = page.getByRole("button", { name: "Accept" });
    await expect(accept).toBeEnabled();

    await page.context().setOffline(true);
    await expect(page.getByText(/you're offline/i)).toBeVisible();
    // Disabled AND told why. A greyed button with no reason is the state this
    // whole banner exists to replace.
    await expect(accept).toBeDisabled();
    // Both attributes reach the DOM: the tooltip a pointer gets, and the
    // description a screen reader reads out.
    await expect(accept).toHaveAttribute("title", /you're offline/i);
    await expect(accept).toHaveAttribute("aria-description", /you're offline/i);

    await page.context().setOffline(false);
    await expect(page.getByText(/you're offline/i)).toHaveCount(0);
    await expect(accept).toBeEnabled();
  });
});

test.describe("the page nobody meant to open", () => {
  test("404 is the app's own screen, not the browser's", async ({ page, server }) => {
    void server;
    await page.goto("/no-such-page");

    await expect(page.getByRole("heading", { name: /page not found/i })).toBeVisible();
    // The way home is the app's button, which is what says this is a themed
    // screen rather than a stock router fallback.
    const home = page.getByRole("link", { name: /go home/i });
    await expect(home).toBeVisible();
    await expect(home).toHaveClass(/neon-btn/);

    // Dark ground and light type, read off the rendered page rather than a
    // committed screenshot: a snapshot would fail on every font tweak and say
    // nothing about the thing that actually went wrong before, which was a white
    // card in a black app.
    const [bg, fg] = await page.evaluate(() => {
      const s = getComputedStyle(document.body);
      return [s.backgroundColor, s.color];
    });
    expect(lightness(bg)).toBeLessThan(0.3);
    expect(lightness(fg)).toBeGreaterThan(0.85);

    // And the nav is still there, so this is a wrong turn rather than a dead end.
    await expect(page.getByRole("link", { name: /^vault$/i }).first()).toBeVisible();
  });
});
