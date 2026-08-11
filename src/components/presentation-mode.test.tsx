// Presentation mode's contract with the app shell.
//
// The animation is not the point and is not testable here — motion does not tick
// in jsdom. What is worth pinning is the flag itself, because every failure mode
// is the same shape and all of them are stranding: chrome that fades out and
// never comes back leaves a phone with no navigation on it at all.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PresentationMode, PresentationProvider, PresentationStage } from "./presentation-mode";
import { useIsPresenting } from "@/hooks/use-presentation";

/** Stands in for SiteNav, which needs a router and is not what is under test. */
function Chrome() {
  return <div data-testid="chrome">{useIsPresenting() ? "hidden" : "shown"}</div>;
}

function renderShell(active: boolean) {
  return render(
    <PresentationProvider>
      <Chrome />
      <PresentationMode active={active} />
    </PresentationProvider>,
  );
}

const chrome = () => screen.getByTestId("chrome").textContent;

describe("presentation mode", () => {
  it("leaves the chrome alone until a screen asks for the device", () => {
    renderShell(false);
    expect(chrome()).toBe("shown");
  });

  it("stands the chrome down while a scene is playing", () => {
    renderShell(true);
    expect(chrome()).toBe("hidden");
  });

  it("gives the screen back when the scene ends", () => {
    const { rerender } = renderShell(true);
    expect(chrome()).toBe("hidden");
    rerender(
      <PresentationProvider>
        <Chrome />
        <PresentationMode active={false} />
      </PresentationProvider>,
    );
    expect(chrome()).toBe("shown");
  });

  /**
   * The failure this exists for: a back gesture out of the pack mid-ceremony.
   * The route unmounts with the flag still set, and without the cleanup every
   * screen after it renders with no header and no bottom nav — on a phone, with
   * no way to navigate anywhere.
   */
  it("gives the screen back when the presenting route simply leaves", () => {
    function Shell({ present }: { present: boolean }) {
      return (
        <PresentationProvider>
          <Chrome />
          {present && <PresentationMode active />}
        </PresentationProvider>
      );
    }
    const { rerender } = render(<Shell present />);
    expect(chrome()).toBe("hidden");

    rerender(<Shell present={false} />);
    expect(chrome()).toBe("shown");
  });
});

describe("the stage", () => {
  it("is not in the tree at all until something is being presented", () => {
    const { container } = render(<PresentationStage active={false} />);
    expect(container.firstChild).toBeNull();
  });

  // Decoration, and only decoration. A screen reader being told about a dimming
  // layer is being told about a lighting cue.
  it("is hidden from the accessibility tree while it is up", () => {
    const { container } = render(<PresentationStage active />);
    expect(container.querySelector("[aria-hidden]")).not.toBeNull();
    expect(container.textContent).toBe("");
  });
});
