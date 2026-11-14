import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ImageDropZone } from "./image-drop-zone";
import { isUploadImage } from "./image-limits";

const png = (name = "a.png") => new File(["x"], name, { type: "image/png" });

describe("isUploadImage", () => {
  it("accepts the three formats by type, and by extension when the browser reports no type", () => {
    expect(isUploadImage(png())).toBe(true);
    expect(isUploadImage(new File(["x"], "scan.JPEG", { type: "" }))).toBe(true);
    expect(isUploadImage(new File(["x"], "doc.pdf", { type: "application/pdf" }))).toBe(false);
  });
});

describe("ImageDropZone", () => {
  it("hands dropped files over, only the first unless it takes several", () => {
    const one = vi.fn();
    const { rerender } = render(<ImageDropZone onFiles={one}>Drop here</ImageDropZone>);
    const files = [png("a.png"), png("b.png")];
    fireEvent.drop(screen.getByRole("button"), { dataTransfer: { files } });
    expect(one).toHaveBeenCalledWith([files[0]]);

    const many = vi.fn();
    rerender(
      <ImageDropZone onFiles={many} multiple>
        Drop here
      </ImageDropZone>,
    );
    fireEvent.drop(screen.getByRole("button"), { dataTransfer: { files } });
    expect(many).toHaveBeenCalledWith(files);
  });

  it("opens the picker from the keyboard but not while busy by click", () => {
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    render(
      <ImageDropZone onFiles={vi.fn()} busy>
        Drop here
      </ImageDropZone>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(click).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("button"), { key: "Enter" });
    expect(click).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });
});
