// Two weight saves in flight at once.
//
// Weight saves on blur, so getting two outstanding takes only a commissioner
// moving down the list faster than the network comes back — and the tile reads
// its own `savingWeight` to decide when to stop showing what was typed and go
// back to what is stored. A flag shared between rows makes that decision for the
// wrong card.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { createQueryWrapper } from "@/test/query";
import { SecretCardsPanel } from "./secret-cards-panel";

const listSecretCards = vi.fn();
const updateSecretCard = vi.fn();
const grantSecretCard = vi.fn();

vi.mock("@/lib/secret-cards.functions", () => ({
  listSecretCards: (...a: unknown[]) => listSecretCards(...a),
  updateSecretCard: (...a: unknown[]) => updateSecretCard(...a),
  createSecretCards: vi.fn(),
  createSecretCollection: vi.fn(),
  deleteSecretCard: vi.fn(),
  deleteSecretCollection: vi.fn(),
  grantSecretCard: (...a: unknown[]) => grantSecretCard(...a),
  updateSecretCollection: vi.fn(),
  updateSecretCollectionLook: vi.fn(),
  uploadSecretCardArt: vi.fn(),
}));

vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});

vi.mock("@/components/admin-section", () => ({
  AdminSection: (props: { children: ReactNode }) => <section>{props.children}</section>,
}));

vi.mock("@/components/secret-look-picker", () => ({
  FoilPicker: () => <div />,
  BorderFxPicker: () => <div />,
}));

vi.mock("@/components/set-accent-picker", () => ({
  SetAccentPicker: () => <div />,
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    promise: vi.fn(),
  }),
}));

vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const stubs: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(actual)) {
    stubs[name] =
      typeof value === "function"
        ? (props: Record<string, unknown>) => <svg data-lucide-stub={name} {...props} />
        : value;
  }
  return stubs;
});

function card(id: string, name: string, weight: number) {
  return {
    id,
    name,
    flavour: null,
    foil: "nebula",
    borderFx: "none",
    collection: "set-wild",
    active: true,
    weight,
    hasArt: true,
    artUrl: null,
    ownerCount: 0,
  };
}

/** A promise this test decides when to settle, standing in for the round trip. */
function deferred() {
  let resolve!: (v: unknown) => void;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const box = (name: string) => screen.getByLabelText(`Pull weight for ${name}`) as HTMLInputElement;

/**
 * Mount the panel with both cards on screen.
 *
 * Sets render collapsed, so the header has to be opened first. The cards are
 * filed into a named set rather than left unsorted because "Unsorted" also
 * names the upload picker's default option, and two buttons by that name is an
 * ambiguity the test does not need.
 */
async function openPanel() {
  const { wrapper } = createQueryWrapper();
  render(<SecretCardsPanel />, { wrapper });
  await userEvent.click(await screen.findByRole("button", { name: /wildcards/i }));
  await screen.findByLabelText("Pull weight for Alpha");
}

beforeEach(() => {
  listSecretCards.mockReset().mockResolvedValue({
    cards: [card("a", "Alpha", 100), card("b", "Beta", 200)],
    participants: [],
    collections: [{ id: "set-wild", label: "Wildcards", accent: null }],
    claimedMembers: 13,
    exhausted: false,
  });
  updateSecretCard.mockReset();
  grantSecretCard.mockReset();
});

describe("two weight saves at once", () => {
  it("leaves the second row saving until its own request comes back", async () => {
    // One shared in-flight id meant whichever request finished first cleared
    // BOTH rows: the still-pending row was re-enabled and its box snapped back
    // to the stored weight, throwing away the number the commissioner had just
    // typed into it.
    const alpha = deferred();
    const beta = deferred();
    updateSecretCard
      .mockImplementationOnce(() => alpha.promise)
      .mockImplementationOnce(() => beta.promise);

    await openPanel();

    await userEvent.clear(box("Alpha"));
    await userEvent.type(box("Alpha"), "150");
    await userEvent.tab();

    await userEvent.clear(box("Beta"));
    await userEvent.type(box("Beta"), "250");
    await userEvent.tab();

    await waitFor(() => expect(updateSecretCard).toHaveBeenCalledTimes(2));
    expect(box("Alpha")).toBeDisabled();
    expect(box("Beta")).toBeDisabled();

    // Alpha's round trip lands. Beta's has not.
    alpha.resolve({ ok: true });
    await waitFor(() => expect(box("Alpha")).toBeEnabled());

    expect(box("Beta")).toBeDisabled();
    expect(box("Beta").value).toBe("250");

    beta.resolve({ ok: true });
    await waitFor(() => expect(box("Beta")).toBeEnabled());
  });

  it("still lets go of a single row once its save lands", async () => {
    // The other direction: the per-row flag must still clear, or a row would
    // stay disabled for the rest of the session.
    const alpha = deferred();
    updateSecretCard.mockImplementationOnce(() => alpha.promise);

    await openPanel();
    await userEvent.clear(box("Alpha"));
    await userEvent.type(box("Alpha"), "150");
    await userEvent.tab();

    await waitFor(() => expect(box("Alpha")).toBeDisabled());
    alpha.resolve({ ok: true });
    await waitFor(() => expect(box("Alpha")).toBeEnabled());
  });
});

describe("two grants at once", () => {
  it("leaves the second row's spinner on until its own request comes back", async () => {
    // The same shape as the weight saves above, one feature over: a single
    // in-flight id meant starting Beta's grant took Alpha's spinner down while
    // Alpha was still in the air, and Alpha landing then cleared Beta's.
    listSecretCards.mockResolvedValue({
      cards: [card("a", "Alpha", 100), card("b", "Beta", 200)],
      participants: [
        { id: "p-alice", name: "Alice" },
        { id: "p-bob", name: "Bob" },
      ],
      collections: [{ id: "set-wild", label: "Wildcards", accent: null }],
      claimedMembers: 13,
      exhausted: false,
    });
    const alpha = deferred();
    const beta = deferred();
    grantSecretCard
      .mockImplementationOnce(() => alpha.promise)
      .mockImplementationOnce(() => beta.promise);
    const granted = { ok: true, duplicate: false, completedCollection: null, repeat: false };

    await openPanel();
    await userEvent.selectOptions(screen.getByLabelText("Grant Alpha to"), "Alice");
    await userEvent.selectOptions(screen.getByLabelText("Grant Beta to"), "Bob");

    const buttons = screen.getAllByRole("button", { name: /^Grant$/ });
    expect(buttons).toHaveLength(2);
    await userEvent.click(buttons[0]);
    await userEvent.click(buttons[1]);

    await waitFor(() => expect(grantSecretCard).toHaveBeenCalledTimes(2));
    expect(screen.getAllByText("Granting…")).toHaveLength(2);

    // Alpha's round trip lands. Beta's has not.
    alpha.resolve(granted);
    await waitFor(() => expect(screen.getAllByText("Granting…")).toHaveLength(1));

    beta.resolve(granted);
    await waitFor(() => expect(screen.queryByText("Granting…")).toBeNull());
  });
});

describe("the exhaustion banner", () => {
  /**
   * Weight 0 takes a card out of the daily draw without retiring it, so nobody
   * can ever have pulled it. The server already excludes it from the `pullable`
   * set it decides `exhausted` with; the banner recounted the cards itself with
   * the looser filter, so the one sentence whose whole payload is a number
   * named a total that included a card no pack could deal.
   */
  it("counts only the cards a pack could actually deal", async () => {
    listSecretCards.mockResolvedValue({
      cards: [card("a", "Alpha", 100), card("b", "Beta", 0)],
      participants: [],
      collections: [{ id: "set-wild", label: "Wildcards", accent: null }],
      claimedMembers: 13,
      exhausted: true,
    });

    const { wrapper } = createQueryWrapper();
    render(<SecretCardsPanel />, { wrapper });

    expect(await screen.findByText(/Everyone who plays has pulled all/)).toHaveTextContent(
      "pulled all 1",
    );
  });
});
