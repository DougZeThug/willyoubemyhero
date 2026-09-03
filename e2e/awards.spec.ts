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

  test("quick votes across categories reconcile once, after the last settles", async ({
    page,
    server,
  }) => {
    // Concurrent mutations: the first response's refetch cannot yet contain
    // votes still on the wire, so an early reconcile would snuff chips that
    // are merely pending. The invalidate waits for the last one standing —
    // pinned here as exactly ONE ballot refetch for two quick votes, plus
    // both chips staying lit once the recorded ballot comes back.
    server.delay("castAwardVote", 1_200);
    server.set("getMyAwardVotes", [
      { category: "mvp", target_participant_id: "p-bob" },
      { category: "best_card", target_participant_id: "p-carol" },
    ]);
    await asMember(page);
    await page.goto("/awards");

    const mvp = page.locator("section").filter({ hasText: "MVP" }).first();
    const art = page.locator("section").filter({ hasText: "Best Card Art" }).first();
    const first = mvp.getByRole("button", { name: /Bob/i });
    const second = art.getByRole("button", { name: /Carol/i });

    const ballotFetches = () => server.calls.filter((c) => c.includes("getMyAwardVotes")).length;
    // Let the initial load settle so the count below is only about the votes.
    await expect(first).toBeEnabled();
    await page.waitForTimeout(300);
    const before = ballotFetches();

    await first.click();
    await second.click();
    await expect(first).toHaveClass(/bg-primary\/15/, { timeout: 1_000 });
    await expect(second).toHaveClass(/bg-primary\/15/, { timeout: 1_000 });

    // Both responses land, the single reconcile confirms the ballot.
    await page.waitForTimeout(2_200);
    await expect(first).toHaveClass(/bg-primary\/15/);
    await expect(second).toHaveClass(/bg-primary\/15/);
    expect(ballotFetches()).toBe(before + 1);
  });

  test("a refused vote with no ballot loaded yet still snaps back", async ({ page, server }) => {
    // Voting is possible before the ballot query has ever answered, and a
    // rollback to an undefined snapshot is a no-op in the query cache — the
    // refused chip used to stay lit. The entry is dropped instead.
    server.delay("getMyAwardVotes", 8_000);
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
