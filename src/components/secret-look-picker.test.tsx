import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BorderFxPicker, FoilPicker } from "./secret-look-picker";
import { SECRET_BORDER_FX_OPTIONS, SECRET_FOIL_OPTIONS, secretFoil } from "@/lib/secret-cards";

const noop = () => {};

/** The swatch is the radio's sibling — see ChipRadio. */
function chipFor(name: string) {
  return screen.getByRole("radio", { name }).nextElementSibling;
}

describe("FoilPicker", () => {
  it("offers every foil an admin can pick, as a swatch each", () => {
    render(<FoilPicker value="rosette" onChange={noop} cardName="Zucchini" />);
    const group = screen.getByRole("radiogroup", { name: "Color effect for Zucchini" });
    expect(within(group).getAllByRole("radio")).toHaveLength(SECRET_FOIL_OPTIONS.length);
  });

  it("checks exactly the chosen one", () => {
    render(<FoilPicker value="aurora" onChange={noop} cardName="Zucchini" />);
    expect(screen.getByRole("radio", { name: "Aurora" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Ember" })).not.toBeChecked();
  });

  it("paints each swatch with that foil's own gradient", () => {
    // The whole point of the change: the chip has to be the colour it sells, not
    // a generic dot, or we are back to picking a look by reading its name.
    render(<FoilPicker value="rosette" onChange={noop} cardName="Zucchini" />);
    const ember = secretFoil("ember");
    expect(chipFor("Ember")).toHaveStyle({
      backgroundImage: `linear-gradient(135deg, ${ember.holoA}, ${ember.holoB})`,
      // A border rather than an inset box-shadow, because Tailwind builds its
      // rings out of box-shadow and an inline one erases the selected ring.
      borderColor: ember.border,
    });
  });

  it("leaves box-shadow alone so the selected ring survives", () => {
    render(<FoilPicker value="aurora" onChange={noop} cardName="Zucchini" />);
    expect((chipFor("Aurora") as HTMLElement).style.boxShadow).toBe("");
  });

  it("reports the id, never the label — the id is what gets stored", () => {
    const onChange = vi.fn();
    render(<FoilPicker value="rosette" onChange={onChange} cardName="Zucchini" />);
    fireEvent.click(screen.getByRole("radio", { name: "Liquid Chrome" }));
    expect(onChange).toHaveBeenCalledWith("chrome");
  });

  it("still prints the chosen look's name", () => {
    // Losing the dropdown must not lose the vocabulary people argue in.
    render(<FoilPicker value="ultraviolet" onChange={noop} cardName="Zucchini" />);
    expect(screen.getByText("Ultraviolet")).toBeInTheDocument();
  });

  it("highlights the default for a value written by a build we do not have", () => {
    // secret_cards.foil carries no CHECK, so a row can hold anything.
    render(<FoilPicker value="from-the-future" onChange={noop} cardName="Zucchini" />);
    expect(screen.getByRole("radio", { name: "Spectral Green" })).toBeChecked();
  });

  it("never disables a chip, so a save cannot steal the keyboard's place", async () => {
    // Disabling a focused radio hands focus straight to <body>. The panel used
    // to grey this strip out while a save was in flight, which cost a keyboard
    // user their position after a single arrow press; it serialises saves
    // instead — see saveLook — so the strip has to stay live.
    const onChange = vi.fn();
    render(<FoilPicker value="rosette" onChange={onChange} cardName="Zucchini" />);
    const aurora = screen.getByRole("radio", { name: "Aurora" });
    expect(aurora).toBeEnabled();
    await userEvent.click(aurora);
    expect(onChange).toHaveBeenCalledWith("aurora");
  });
});

describe("BorderFxPicker", () => {
  it("offers every border effect", () => {
    render(<BorderFxPicker value="spin" foil="rosette" onChange={noop} cardName="Dragon" />);
    const group = screen.getByRole("radiogroup", { name: "Border animation for Dragon" });
    expect(within(group).getAllByRole("radio")).toHaveLength(SECRET_BORDER_FX_OPTIONS.length);
  });

  it("reports the id and checks the chosen one", () => {
    const onChange = vi.fn();
    render(<BorderFxPicker value="spin" foil="rosette" onChange={onChange} cardName="Dragon" />);
    expect(screen.getByRole("radio", { name: "Prism Spin" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "Heartbeat" }));
    expect(onChange).toHaveBeenCalledWith("pulse");
  });

  it("previews the ring in the foil the row actually wears", () => {
    render(<BorderFxPicker value="spin" foil="ember" onChange={noop} cardName="Dragon" />);
    const ember = secretFoil("ember");
    expect(chipFor("Steady")).toHaveStyle({
      "--holo-a": ember.holoA,
      "--holo-b": ember.holoB,
    });
  });

  it("stays still until the strip is the one being touched", () => {
    // styles.css is explicit that a grid of always-animating compositor layers
    // is the cost holo-card avoids; thirteen rows of four rings is that grid.
    const { container, rerender } = render(
      <BorderFxPicker value="spin" foil="rosette" onChange={noop} cardName="Dragon" />,
    );
    expect(container.querySelector(".holo-prism-edge.is-spinning")).toBeNull();

    rerender(
      <BorderFxPicker value="spin" foil="rosette" onChange={noop} animate cardName="Dragon" />,
    );
    expect(container.querySelector(".holo-prism-edge.is-spinning")).not.toBeNull();
    expect(container.querySelector(".holo-prism-edge.is-pulsing")).not.toBeNull();
  });

  it("gives the steady option a ring with no animation class at all", () => {
    render(
      <BorderFxPicker value="spin" foil="rosette" onChange={noop} animate cardName="Dragon" />,
    );
    const ring = chipFor("Steady")?.querySelector(".holo-prism-edge");
    expect(ring).not.toBeNull();
    expect(ring?.className).toBe("holo-prism-edge");
  });
});

// jsdom does not implement the browser's radio-group key handling, so these pin
// the structure that delegates it rather than the keystrokes themselves — the
// arrow keys are exercised against Chromium instead. Buttons wearing
// role="radio" satisfied every assertion above while leaving thirteen Tab stops
// and dead arrow keys, which is what these exist to stop coming back.
describe("keyboard navigation is the browser's, not ours", () => {
  it.each([
    [
      "foil",
      <FoilPicker key="f" value="rosette" onChange={noop} cardName="Zucchini" />,
      "Color effect for Zucchini",
    ],
    [
      "border",
      <BorderFxPicker key="b" value="spin" foil="rosette" onChange={noop} cardName="Zucchini" />,
      "Border animation for Zucchini",
    ],
  ])("wires the %s strip as native radio inputs", (_name, element, groupLabel) => {
    render(element);
    const radios = within(screen.getByRole("radiogroup", { name: groupLabel })).getAllByRole(
      "radio",
    );
    for (const radio of radios) {
      expect(radio.tagName).toBe("INPUT");
      expect(radio).toHaveAttribute("type", "radio");
    }
    // One shared name is what makes the browser treat them as a single tab stop
    // and move the selection on arrow keys.
    expect(new Set(radios.map((r) => r.getAttribute("name"))).size).toBe(1);
  });

  it("keeps the swatch focusable rather than hiding the control", () => {
    // display:none or visibility:hidden would take the input out of the tab
    // order entirely and none of the native behaviour would survive.
    render(<FoilPicker value="rosette" onChange={noop} cardName="Zucchini" />);
    expect(screen.getByRole("radio", { name: "Ember" })).toHaveClass("sr-only");
  });

  it("gives each card its own group, so one row cannot deselect another", () => {
    // Radios group by name across the whole document. Two rows sharing one would
    // make picking Toxic on Zucchini silently clear Dragon's foil.
    render(
      <>
        <FoilPicker value="rosette" onChange={noop} cardName="Zucchini" />
        <FoilPicker value="aurora" onChange={noop} cardName="Dragon" />
      </>,
    );
    const nameOf = (groupLabel: string) =>
      within(screen.getByRole("radiogroup", { name: groupLabel }))
        .getAllByRole("radio")[0]
        .getAttribute("name");

    expect(nameOf("Color effect for Zucchini")).not.toBe(nameOf("Color effect for Dragon"));
    // And each keeps its own selection.
    expect(
      screen.getByRole("radio", { name: "Spectral Green", checked: true }),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Aurora", checked: true })).toBeInTheDocument();
  });
});
