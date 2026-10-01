// Set-level behaviour of the secret cards panel: where a hidden set can still
// leak into an upload, and what "saving" means when two whole-set looks overlap.
//
// Its own file because the sibling suite stubs the look pickers to empty divs and
// files its fixtures without an `active` flag — which, here, means "every set is
// hidden".
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { createQueryWrapper } from "@/test/query";
import { SecretCardsPanel } from "./secret-cards-panel";

const listSecretCards = vi.fn();
const createSecretCards = vi.fn();
const updateSecretCollection = vi.fn();
const updateSecretCollectionLook = vi.fn();

vi.mock("@/lib/secret-cards.functions", () => ({
  listSecretCards: (...a: unknown[]) => listSecretCards(...a),
  createSecretCards: (...a: unknown[]) => createSecretCards(...a),
  updateSecretCollection: (...a: unknown[]) => updateSecretCollection(...a),
  updateSecretCollectionLook: (...a: unknown[]) => updateSecretCollectionLook(...a),
  updateSecretCard: vi.fn(),
  createSecretCollection: vi.fn(),
  deleteSecretCard: vi.fn(),
  deleteSecretCollection: vi.fn(),
  grantSecretCard: vi.fn(),
  uploadSecretCardArt: vi.fn(),
}));

vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});

vi.mock("@/components/admin-section", () => ({
  AdminSection: (props: { children: ReactNode }) => <section>{props.children}</section>,
}));

// Real buttons, so a test can fire a look change and read `disabled`.
vi.mock("@/components/secret-look-picker", () => ({
  FoilPicker: (props: { cardName: string; disabled?: boolean; onChange: (id: string) => void }) => (
    <button
      type="button"
      aria-label={`Foil for ${props.cardName}`}
      data-disabled={props.disabled ? "true" : "false"}
      onClick={() => props.onChange("nebula")}
    />
  ),
  BorderFxPicker: () => <div />,
}));

vi.mock("@/components/set-accent-picker", () => ({
  SetAccentPicker: () => <div />,
}));

// jsdom has no canvas; the encoded bytes are not what these tests are about.
vi.mock("@/lib/image-encode", () => ({
  snapshotFile: (file: File) => Promise.resolve(file),
  encodeUploadImage: () => Promise.resolve("data:image/png;base64,AAAA"),
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

/** A promise this test decides when to settle, standing in for the round trip. */
function deferred() {
  let resolve!: (v: unknown) => void;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function listing(active: boolean) {
  return {
    cards: [
      {
        id: "a",
        name: "Alpha",
        flavour: null,
        foil: "nebula",
        borderFx: "none",
        collection: "set-wild",
        active: true,
        weight: 100,
        hasArt: true,
        artUrl: null,
        ownerCount: 0,
      },
    ],
    participants: [],
    collections: [{ id: "set-wild", label: "Wildcards", accent: null, active }],
    claimedMembers: 13,
    exhausted: false,
  };
}

/** The list loads after the select is on screen, so wait for its option. */
/** Sets are folded away by default; open the manager so the eye toggle is there. */
async function openSetManager() {
  await userEvent.click(await screen.findByRole("button", { name: /^sets/i }));
}

async function pickUploadSet(target: HTMLSelectElement) {
  await within(target).findByRole("option", { name: "Wildcards" });
  await userEvent.selectOptions(target, "set-wild");
}

function mount() {
  const { wrapper } = createQueryWrapper();
  render(<SecretCardsPanel />, { wrapper });
}

beforeEach(() => {
  listSecretCards.mockReset().mockResolvedValue(listing(true));
  createSecretCards.mockReset().mockResolvedValue({ results: [{ ok: true }] });
  updateSecretCollection.mockReset().mockResolvedValue({ ok: true });
  updateSecretCollectionLook.mockReset();
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});

describe("a set hidden while it is the upload target", () => {
  it("files the next drop under Unsorted, as every dropdown says", async () => {
    // The sticky target kept the hidden set's id while each <select> fell back to
    // showing "Unsorted" — so a batch was filed somewhere no control on screen
    // admitted to.
    mount();
    const target = (await screen.findByLabelText("Set for new uploads")) as HTMLSelectElement;
    await pickUploadSet(target);
    expect(target.value).toBe("set-wild");

    listSecretCards.mockResolvedValue(listing(false));
    await openSetManager();
    await userEvent.click(await screen.findByRole("button", { name: "Hide Wildcards" }));
    await waitFor(() => expect(target.value).toBe(""));

    const input = document.querySelector('input[type="file"][multiple]') as HTMLInputElement;
    await userEvent.upload(input, new File(["x"], "alpha.png", { type: "image/png" }));
    await userEvent.click(await screen.findByRole("button", { name: /add 1 to the set/i }));

    await waitFor(() => expect(createSecretCards).toHaveBeenCalledTimes(1));
    expect(createSecretCards.mock.calls[0][0].data.cards[0].collection).toBeUndefined();
  });

  it("does not file an already-staged draft into it either", async () => {
    mount();
    const target = (await screen.findByLabelText("Set for new uploads")) as HTMLSelectElement;
    await pickUploadSet(target);
    const input = document.querySelector('input[type="file"][multiple]') as HTMLInputElement;
    await userEvent.upload(input, new File(["x"], "alpha.png", { type: "image/png" }));
    expect(((await screen.findByLabelText("Set for alpha.png")) as HTMLSelectElement).value).toBe(
      "set-wild",
    );

    listSecretCards.mockResolvedValue(listing(false));
    await openSetManager();
    await userEvent.click(await screen.findByRole("button", { name: "Hide Wildcards" }));
    await waitFor(() =>
      expect((screen.getByLabelText("Set for alpha.png") as HTMLSelectElement).value).toBe(""),
    );

    await userEvent.click(screen.getByRole("button", { name: /add 1 to the set/i }));
    await waitFor(() => expect(createSecretCards).toHaveBeenCalledTimes(1));
    expect(createSecretCards.mock.calls[0][0].data.cards[0].collection).toBeUndefined();
  });

  it("restores the choice when the set is shown again", async () => {
    // Clamped where it is read, not reset: un-hiding is not a different set.
    mount();
    const target = (await screen.findByLabelText("Set for new uploads")) as HTMLSelectElement;
    await pickUploadSet(target);

    listSecretCards.mockResolvedValue(listing(false));
    await openSetManager();
    await userEvent.click(await screen.findByRole("button", { name: "Hide Wildcards" }));
    await waitFor(() => expect(target.value).toBe(""));

    listSecretCards.mockResolvedValue(listing(true));
    await userEvent.click(await screen.findByRole("button", { name: "Show Wildcards" }));
    await waitFor(() => expect(target.value).toBe("set-wild"));
  });
});

describe("two whole-set looks at once", () => {
  it("keeps the set saving until the LAST write lands", async () => {
    // Each call cleared the flag in its own `.finally`, so whichever write came
    // back first re-enabled the strip with the other still in the air.
    const first = deferred();
    const second = deferred();
    updateSecretCollectionLook
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    mount();
    await userEvent.click(await screen.findByRole("button", { name: /wildcards/i }));
    const foil = await screen.findByRole("button", { name: "Foil for every card in Wildcards" });

    // Fired without waiting for a re-render, as a held-down arrow key would.
    foil.click();
    foil.click();
    await waitFor(() => expect(updateSecretCollectionLook).toHaveBeenCalledTimes(1));
    expect(foil).toHaveAttribute("data-disabled", "true");

    first.resolve({ updated: 1 });
    // The second write has not even been sent yet: it is chained behind the first.
    await waitFor(() => expect(updateSecretCollectionLook).toHaveBeenCalledTimes(2));
    expect(foil).toHaveAttribute("data-disabled", "true");

    second.resolve({ updated: 1 });
    await waitFor(() => expect(foil).toHaveAttribute("data-disabled", "false"));
  });
});
