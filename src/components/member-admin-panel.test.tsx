// The plaintext of a member code exists in exactly two places: the response that
// carried it, and this panel. So the thing to protect is the panel's resting
// state — the roster with its per-row Issue buttons — against being swapped out
// for an amber code list that has no codes in it.
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { createQueryWrapper } from "@/test/query";
import { MemberCodesPanel } from "./member-admin-panel";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

const generate = vi.hoisted(() => vi.fn());
const listClaims = vi.hoisted(() => vi.fn());

// The panel reaches for two server fns. Rather than tell them apart by identity
// inside useServerFn, the module is mocked to hand over the spies themselves and
// useServerFn passes through — the same shape use-run-console.test.tsx uses.
vi.mock("@/lib/member.functions", () => ({
  generateMemberCodes: generate,
  listMemberClaims: listClaims,
}));
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: unknown) => fn,
}));

const EVENT = "00000000-0000-4000-8000-0000000000ff";
const ALICE = "00000000-0000-4000-8000-0000000000a1";
const BOB = "00000000-0000-4000-8000-0000000000b1";

vi.mock("@/hooks/use-event-bundle", () => ({
  useEventBundle: () => ({
    event: { id: EVENT, name: "Draft Combine", year: 2026 },
    bundle: {
      participants: [
        { id: "ep-1", participant_id: ALICE, participant: { name: "Alice" } },
        { id: "ep-2", participant_id: BOB, participant: { name: "Bob" } },
      ],
    },
    failedTables: [],
  }),
}));

function renderPanel() {
  const { wrapper: Wrapper } = createQueryWrapper();
  return render(
    <Wrapper>
      <MemberCodesPanel eventId={EVENT} />
    </Wrapper>,
  );
}

/** The roster list is identified by its per-row Issue buttons. */
const rosterButtons = () => screen.queryAllByRole("button", { name: /^(Issue|Again)$/ });

beforeEach(() => {
  vi.clearAllMocks();
  // Both claimed already, which is the state that makes the server mint nothing.
  listClaims.mockResolvedValue([
    { participant_id: ALICE, claimed_at: "2026-09-01T00:00:00.000Z", claim_count: 1 },
    { participant_id: BOB, claimed_at: "2026-09-01T00:00:00.000Z", claim_count: 1 },
  ]);
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("MemberCodesPanel issuing an empty batch", () => {
  it("keeps the roster and says there was nothing to issue", async () => {
    // `{ ok: true, issued: [] }` is a successful "nobody to mint for" — no error
    // and no write. Stored as state it was still truthy, so the roster and every
    // per-row Issue button disappeared behind an amber list with nothing in it,
    // under a success toast telling the commissioner to copy it.
    generate.mockResolvedValue({ ok: true, issued: [] });
    renderPanel();
    await waitFor(() => expect(rosterButtons()).toHaveLength(2));

    await userEvent.click(screen.getByRole("button", { name: /Re-issue ALL codes/ }));

    await waitFor(() =>
      expect(toast.info).toHaveBeenCalledWith("Everyone eligible has claimed — nothing to issue"),
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(rosterButtons()).toHaveLength(2);
  });

  it("leaves a code already pinned beside a row on the screen", async () => {
    // The worst of it: a single re-issue's plaintext is pinned next to its row
    // and exists nowhere else. An empty batch used to hide it.
    generate.mockResolvedValueOnce({
      ok: true,
      issued: [{ participantId: ALICE, name: "Alice", code: "ABCD-1234" }],
    });
    renderPanel();
    await waitFor(() => expect(rosterButtons()).toHaveLength(2));

    await userEvent.click(rosterButtons()[0]);
    await waitFor(() => expect(screen.getAllByText("ABCD-1234").length).toBeGreaterThan(0));

    generate.mockResolvedValueOnce({ ok: true, issued: [] });
    await userEvent.click(screen.getByRole("button", { name: /Re-issue ALL codes/ }));

    await waitFor(() => expect(toast.info).toHaveBeenCalled());
    expect(screen.getAllByText("ABCD-1234").length).toBeGreaterThan(0);
  });

  it("still swaps to the code list for a real batch", async () => {
    generate.mockResolvedValue({
      ok: true,
      issued: [
        { participantId: ALICE, name: "Alice", code: "ABCD-1234" },
        { participantId: BOB, name: "Bob", code: "EFGH-5678" },
      ],
    });
    renderPanel();
    await waitFor(() => expect(rosterButtons()).toHaveLength(2));

    await userEvent.click(screen.getByRole("button", { name: /Re-issue ALL codes/ }));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Issued 2 codes — copy them now"),
    );
    expect(screen.getByText("ABCD-1234")).toBeInTheDocument();
    expect(screen.getByText("EFGH-5678")).toBeInTheDocument();
    expect(rosterButtons()).toHaveLength(0);
  });
});
