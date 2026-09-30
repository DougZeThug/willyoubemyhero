// The weight box, and what it is showing when nobody is typing in it.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SecretCardTile, type SecretCardAdminRow } from "./secret-card-tile";

vi.mock("@/components/secret-look-picker", () => ({
  FoilPicker: () => <div data-testid="foil-picker" />,
  BorderFxPicker: () => <div data-testid="border-picker" />,
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

const onSaveWeight = vi.fn();

/** The tile at a given saved weight. Only weight and savingWeight ever vary. */
function tile(weight: number, savingWeight = false) {
  const card: SecretCardAdminRow = {
    id: "card-1",
    name: "The Beekeeper",
    flavour: null,
    foil: "nebula",
    borderFx: "none",
    collection: null,
    active: true,
    weight,
    hasArt: true,
    artUrl: null,
    ownerCount: 0,
  };
  return (
    <SecretCardTile
      card={card}
      claimedMembers={13}
      roster={[]}
      sets={[]}
      grantTarget=""
      onGrantTargetChange={vi.fn()}
      granting={false}
      savingWeight={savingWeight}
      savingLook={false}
      lookRow={false}
      onLookRowChange={vi.fn()}
      onSaveWeight={onSaveWeight}
      onSaveLook={vi.fn()}
      onSaveCollection={vi.fn()}
      onGrant={vi.fn()}
      onEdit={vi.fn()}
      busy={false}
    />
  );
}

const weightBox = () => screen.getByLabelText("Pull weight for The Beekeeper") as HTMLInputElement;

beforeEach(() => {
  onSaveWeight.mockClear();
});

describe("the weight the box is showing", () => {
  it("follows the saved weight when it changes underneath", () => {
    // The panel refetches ["secret-cards"] after every save and the tile is
    // never remounted — key={card.id} is stable — so a box seeded once at mount
    // went on showing the old number while the prop moved on without it.
    const { rerender } = render(tile(100));
    expect(weightBox().value).toBe("100");
    rerender(tile(300));
    expect(weightBox().value).toBe("300");
  });

  it("does not re-save a stale number when the box is only focused and left", async () => {
    // The data-integrity half. The "Weight" label wraps the box, so clicking the
    // label text focuses it and clicking away blurs it — no typing at all — and
    // against a stale box that blur wrote the old weight straight back over
    // whatever the other commissioner had just changed it to.
    const { rerender } = render(tile(100));
    rerender(tile(300));

    await userEvent.click(weightBox());
    await userEvent.tab();
    expect(onSaveWeight).not.toHaveBeenCalled();
  });

  it("keeps what is being typed, and saves it on the way out", async () => {
    render(tile(100));
    await userEvent.clear(weightBox());
    await userEvent.type(weightBox(), "250");
    expect(weightBox().value).toBe("250");

    await userEvent.tab();
    expect(onSaveWeight).toHaveBeenCalledWith("250");
  });

  it("holds an emptied box open until the baseline it means comes back", async () => {
    // Clearing the box is how an admin asks for the 100 baseline. The box has to
    // keep showing empty until that lands, and then show the 100 — this is the
    // case where the saved weight may not change at all, which is why letting go
    // of the local edit watches savingWeight and not just card.weight.
    const { rerender } = render(tile(250));
    await userEvent.clear(weightBox());
    expect(weightBox().value).toBe("");

    await userEvent.tab();
    expect(onSaveWeight).toHaveBeenCalledWith("");
    rerender(tile(250, true));
    expect(weightBox().value).toBe("");

    rerender(tile(100));
    expect(weightBox().value).toBe("100");
  });
});
