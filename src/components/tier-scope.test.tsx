import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TierScope } from "@/components/tier-scope";
import { editionStyle } from "@/lib/card-edition";

describe("TierScope", () => {
  it("sets the tier and finish colours for everything inside, keeping the caller's own props", () => {
    render(
      <TierScope accent="oklch(0.8 0.1 200)" edition="standard" data-testid="scope" className="x">
        child
      </TierScope>,
    );
    const el = screen.getByTestId("scope");
    expect(el.style.getPropertyValue("--tier")).toBe("oklch(0.8 0.1 200)");
    expect(el.style.getPropertyValue("--edn")).toBe(editionStyle("standard").accent);
    expect(el.className).toBe("x");
  });
});
