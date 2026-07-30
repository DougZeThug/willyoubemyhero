// Ratings, and the slot layout that draws them over the card art.
//
// The card front used to be one uploaded image with the numbers baked in. These
// tests are about the two halves of unbaking it: that a rating reflects what
// somebody actually did on the course, and that a calibrated slot renders on top
// of the artwork rather than under the foil or in front of the tilt gesture.
//
// Scoping matters here more than usual. The same numbers legitimately appear in
// three places on this page — the slot on the card front, the chips on the card
// back, and the readable panel below — and the back face is `invisible` while
// the front is showing. An unscoped getByText finds the hidden one first.
import type { Page } from "@playwright/test";
import { test, expect, BUNDLE } from "./fixtures";

/** The card's front face. The back is the second one, and it is hidden. */
const cardFront = (page: Page) => page.locator(".holo-face").first();

/** The readable ratings breakdown further down the page. */
const ratingsPanel = (page: Page) =>
  page.locator("section").filter({ has: page.getByRole("heading", { name: "Ratings" }) });

const slot = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  x: 0.06,
  y: 0.05,
  w: 0.3,
  h: 0.14,
  size: 0.1,
  align: "center",
  plate: { color: "rgb(10 12 20)", radius: 0.02 },
  ...over,
});

const LAYOUT = {
  version: 1,
  aspect: 5 / 7,
  slots: [
    slot("slot-ovr", { key: "ovr", label: "OVR" }),
    slot("slot-time", { key: "time", label: "TIME", y: 0.82, w: 0.45 }),
  ],
};

/**
 * Publish an event-level layout.
 *
 * Both stubs, because the app reads the event row through `getActiveEvent` and
 * the roster through `getEventBundle` — they are the same `events_public` row in
 * production but two separate RPCs here, and the layout has to agree.
 */
function publishLayout(
  server: { set: (key: string, value: unknown) => void },
  layout: unknown,
  bundle: typeof BUNDLE = BUNDLE,
) {
  const event = { ...bundle.event, card_layout: layout };
  server.set("getActiveEvent", event);
  server.set("getEventBundle", { ...bundle, event });
}

test.describe("card ratings", () => {
  test("gives the fastest runner the top of the scale", async ({ page }) => {
    // Alice owns the fastest official time in the fixture field, so Speed is
    // the ceiling and nothing else in the field can beat it.
    await page.goto("/players/ep-alice");
    const panel = ratingsPanel(page);
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("Speed");
    await expect(panel.getByText("99").first()).toBeVisible();
  });

  test("puts the slowest runner below the fastest", async ({ page }) => {
    const readOvr = async (id: string) => {
      await page.goto(`/players/${id}`);
      const panel = ratingsPanel(page);
      await expect(panel).toBeVisible();
      return Number(await panel.getByText(/^\d+$/).first().innerText());
    };
    // Carol is last of the three who ran.
    expect(await readOvr("ep-alice")).toBeGreaterThan(await readOvr("ep-carol"));
  });

  test("rates a player who never ran at nothing rather than at zero", async ({ page }) => {
    // Dave is scratched. A 0 would read as "terrible" instead of "did not run".
    await page.goto("/players/ep-dave");
    await expect(page.locator("body")).toContainText(/DNF|did not finish/i);
    await expect(ratingsPanel(page)).toHaveCount(0);
  });

  test("marks the numbers provisional while someone still has a run to post", async ({
    page,
    server,
  }) => {
    server.set("getEventBundle", {
      ...BUNDLE,
      // Bob's run withdrawn: he is neither scratched nor timed, so the field is
      // incomplete and every rating in it is still moving.
      runs: BUNDLE.runs.filter((r) => r.participant_id !== "p-bob"),
    });
    await page.goto("/players/ep-alice");
    await expect(ratingsPanel(page)).toContainText("Provisional");
  });

  test("says nothing about provisional once the whole field has run", async ({ page }) => {
    await page.goto("/players/ep-alice");
    await expect(ratingsPanel(page)).toBeVisible();
    await expect(ratingsPanel(page)).not.toContainText("Provisional");
  });
});

test.describe("the calibrated card front", () => {
  test("draws nothing over the art until a layout exists", async ({ page }) => {
    await page.goto("/players/ep-alice");
    await expect(page.locator("body")).toContainText("Alice Ace");
    await expect(cardFront(page).getByText("OVR", { exact: true })).toHaveCount(0);
  });

  test("renders the slots over the card once the event has a layout", async ({ page, server }) => {
    publishLayout(server, LAYOUT);
    await page.goto("/players/ep-alice");
    const front = cardFront(page);
    await expect(front.getByText("OVR", { exact: true })).toHaveCount(1);
    await expect(front.getByText("TIME", { exact: true })).toHaveCount(1);
    // 50s in the fixture, formatted at the edge by formatTime.
    await expect(front.getByText("50.00")).toHaveCount(1);
  });

  test("stacks the slots above the foil and out of the gesture's way", async ({ page, server }) => {
    publishLayout(server, LAYOUT);
    await page.goto("/players/ep-alice");
    const front = cardFront(page);
    await expect(front.getByText("OVR", { exact: true })).toHaveCount(1);

    const stacking = await front.evaluate((face) => {
      const overlay = face.lastElementChild as HTMLElement | null;
      const foil = face.querySelector(".holo-foil");
      return {
        // Last child: the foil is a color-dodge film, and a number underneath it
        // washes out. This ordering is the whole reason it renders after Overlays.
        overlayIsLast: !!overlay?.textContent?.includes("OVR"),
        overlayAfterFoil:
          !!foil && !!overlay && !!(foil.compareDocumentPosition(overlay) & Node.DOCUMENT_POSITION_FOLLOWING), // prettier-ignore
        // The page is built around picking the card up and tilting it.
        pointerEvents: overlay ? getComputedStyle(overlay).pointerEvents : null,
      };
    });
    expect(stacking.overlayIsLast).toBe(true);
    expect(stacking.overlayAfterFoil).toBe(true);
    expect(stacking.pointerEvents).toBe("none");
  });

  test("carries only the overall onto the vault grid thumbnails", async ({ page, server }) => {
    publishLayout(server, LAYOUT);
    await page.goto("/players");
    await expect(page.locator("body")).toContainText("Alice Ace");
    // Compact mode: the overall rides every thumbnail, the time does not — text
    // at thumbnail size is unreadable and thirty of them is real paint cost.
    await expect(cardFront(page).getByText("OVR", { exact: true })).toHaveCount(1);
    await expect(page.getByText("TIME", { exact: true })).toHaveCount(0);
  });

  test("ignores a layout with nothing drawable in it", async ({ page, server }) => {
    publishLayout(server, { version: 1, slots: [] });
    await page.goto("/players/ep-alice");
    await expect(page.locator("body")).toContainText("Alice Ace");
    await expect(cardFront(page).getByText("OVR", { exact: true })).toHaveCount(0);
  });

  test("drops a slot bound to a stat that does not exist", async ({ page, server }) => {
    publishLayout(server, {
      version: 1,
      slots: [...LAYOUT.slots, slot("slot-junk", { key: "salary", label: "PAY" })],
    });
    await page.goto("/players/ep-alice");
    const front = cardFront(page);
    await expect(front.getByText("OVR", { exact: true })).toHaveCount(1);
    await expect(front.getByText("PAY", { exact: true })).toHaveCount(0);
  });

  test("lets a player's own layout beat the event default", async ({ page, server }) => {
    publishLayout(server, LAYOUT, {
      ...BUNDLE,
      participants: BUNDLE.participants.map((p) =>
        p.id === "ep-alice"
          ? {
              ...p,
              card_layout: {
                version: 1,
                aspect: 5 / 7,
                slots: [slot("slot-rank", { key: "rank", label: "RANK" })],
              },
            }
          : p,
      ),
    });
    await page.goto("/players/ep-alice");
    const front = cardFront(page);
    await expect(front.getByText("RANK", { exact: true })).toHaveCount(1);
    await expect(front.getByText("TIME", { exact: true })).toHaveCount(0);
  });
});
