import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { BorderFxPicker, FoilPicker } from "./secret-look-picker";
import { SECRET_BORDER_FX_OPTIONS, SECRET_FOIL_OPTIONS, secretFoil } from "@/lib/secret-cards";

const noop = () => {};

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
    expect(screen.getByRole("radio", { name: "Ember" })).toHaveStyle({
      backgroundImage: `linear-gradient(135deg, ${ember.holoA}, ${ember.holoB})`,
      // A border rather than an inset box-shadow, because Tailwind builds its
      // rings out of box-shadow and an inline one erases the selected ring.
      borderColor: ember.border,
    });
  });

  it("leaves box-shadow alone so the selected ring survives", () => {
    render(<FoilPicker value="aurora" onChange={noop} cardName="Zucchini" />);
    expect(screen.getByRole("radio", { name: "Aurora" }).style.boxShadow).toBe("");
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

  it("takes no clicks mid-save", () => {
    const onChange = vi.fn();
    render(<FoilPicker value="rosette" onChange={onChange} disabled cardName="Zucchini" />);
    fireEvent.click(screen.getByRole("radio", { name: "Aurora" }));
    expect(onChange).not.toHaveBeenCalled();
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
    expect(screen.getByRole("radio", { name: "Steady" })).toHaveStyle({
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
    const steady = screen.getByRole("radio", { name: "Steady" });
    const ring = steady.querySelector(".holo-prism-edge");
    expect(ring).not.toBeNull();
    expect(ring?.className).toBe("holo-prism-edge");
  });
});
