// Superlative voting. The flow had no end-to-end coverage at all, and the one
// property worth pinning is new: the chip is optimistic, so it must light
// before the server answers and snap back when the server says no.
import { test, expect } from "./fixtures";

const MEMBER_KEY = "wwbh:member-token";

function asMember(page: Parameters<Parameters<typeof test>[2]>[0]["page"]) {
  return page.addInitScript(
    ([key, token]: readonly [string, string]) => localStorage.setItem(key, token),
    [MEMBER_KEY, `m.p-alice.${Date.now() + 60 * 60_000}.signature`] as const,
  );
}

test.describe("awards voting", () => {
  test("a tap lights the chip before the server answers", async ({ page, server }) => {
    // Thirteen categories on garden WiFi: waiting a round trip per chip is
    // where the voting session used to die. Hold the server's answer back and
    // the choice must show anyway.
    server.delay("castAwardVote", 4_000);
    await asMember(page);
    await page.goto("/awards");

    const mvp = page.locator("section").filter({ hasText: "MVP" }).first();
    const chip = mvp.getByRole("button", { name: /Bob/i });
    await chip.click();

    // Well inside the held-back window — this is the optimistic paint, not the
    // response landing. bg-primary/15 rather than border-primary: the
    // UNSELECTED chip carries hover:border-primary/40, which a border match
    // would hit, and this assertion must be able to fail.
    await expect(chip).toHaveClass(/bg-primary\/15/, { timeout: 1_500 });
  });

  test("a refused vote snaps back and says why", async ({ page, server }) => {
    server.fail("castAwardVote", "Voting is locked");
    await asMember(page);
    await page.goto("/awards");

    const mvp = page.locator("section").filter({ hasText: "MVP" }).first();
    const chip = mvp.getByRole("button", { name: /Bob/i });
    await chip.click();

    await expect(page.getByText(/voting is locked|could not vote/i).first()).toBeVisible();
    await expect(chip).not.toHaveClass(/bg-primary\/15/);
  });

  test("a signed-out visitor cannot cast anything", async ({ page, server }) => {
    await page.goto("/awards");
    const mvp = page.locator("section").filter({ hasText: "MVP" }).first();
    const chip = mvp.getByRole("button", { name: /Bob/i });
    await expect(chip).toBeDisabled();
    expect(server.calls.filter((c) => c.includes("castAwardVote"))).toHaveLength(0);
  });
});
