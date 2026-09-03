// The focus rules the three reveals share. What they have to get right: the
// surface takes focus, Tab cannot leave it while it is up, and whatever opened
// it gets focus back — none of which role="dialog" does on its own.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useModalSurface } from "./use-modal-surface";

function Surface({ active = true, buttons = 2 }: { active?: boolean; buttons?: number }) {
  const ref = useModalSurface<HTMLDivElement>(active);
  return (
    <div ref={ref} tabIndex={-1} data-testid="surface">
      {Array.from({ length: buttons }, (_, i) => (
        <button key={i} data-testid={`in-${i}`}>
          in {i}
        </button>
      ))}
    </div>
  );
}

function Harness({ open, buttons = 2 }: { open: boolean; buttons?: number }) {
  return (
    <>
      <button data-testid="opener">open</button>
      {open && <Surface buttons={buttons} />}
    </>
  );
}

describe("useModalSurface", () => {
  it("takes focus when it opens", () => {
    render(<Surface />);
    expect(document.activeElement).toBe(screen.getByTestId("surface"));
  });

  it("leaves focus alone while inactive", () => {
    render(<Surface active={false} />);
    expect(document.activeElement).not.toBe(screen.getByTestId("surface"));
  });

  it("wraps Tab from the last control back to the first", () => {
    render(<Surface />);
    screen.getByTestId("in-1").focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByTestId("in-0"));
  });

  it("wraps Shift+Tab from the surface to the last control", () => {
    render(<Surface />);
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByTestId("in-1"));
  });

  it("pulls focus back in when it has escaped the surface", () => {
    render(<Harness open />);
    screen.getByTestId("opener").focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByTestId("in-0"));
  });

  it("holds focus on a surface with nothing to cycle between", () => {
    render(<Surface buttons={0} />);
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByTestId("surface"));
  });

  it("gives focus back to the opener on close", () => {
    const { rerender } = render(<Harness open={false} />);
    const opener = screen.getByTestId("opener");
    opener.focus();
    rerender(<Harness open />);
    expect(document.activeElement).toBe(screen.getByTestId("surface"));
    rerender(<Harness open={false} />);
    expect(document.activeElement).toBe(opener);
  });
});
