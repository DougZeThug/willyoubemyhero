import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { FieldComparison } from "./field-comparison";
import type { LadderRow } from "@/lib/card-stats";

function row(over: Partial<LadderRow> = {}): LadderRow {
  return {
    id: "s1",
    label: "SLED",
    ms: 20_000,
    deltaMs: 0,
    best: false,
    place: 3,
    fieldCount: 8,
    ...over,
  };
}

describe("FieldComparison", () => {
  it("renders nothing when the player has no timed splits", () => {
    const { container } = render(
      <FieldComparison
        ladder={[
          row({ ms: null, deltaMs: null, place: null }),
          row({ id: "s2", ms: null, deltaMs: null, place: null }),
        ]}
        rank={null}
        fieldSize={0}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the placing when there is one", () => {
    render(<FieldComparison ladder={[row()]} rank={2} fieldSize={13} />);
    expect(screen.getByText("#2 of 13")).toBeInTheDocument();
  });

  it("omits the placing for someone with no official time", () => {
    render(<FieldComparison ladder={[row()]} rank={null} fieldSize={13} />);
    expect(screen.queryByText(/of 13/)).not.toBeInTheDocument();
  });

  it("counts how many stations beat the median", () => {
    render(
      <FieldComparison
        ladder={[
          row({ id: "a", deltaMs: -1_000 }),
          row({ id: "b", deltaMs: 500 }),
          row({ id: "c", deltaMs: -250 }),
        ]}
        rank={1}
        fieldSize={4}
      />,
    );
    expect(screen.getByText(/Faster than median at 2\/3/)).toBeInTheDocument();
  });

  it("does not count an exactly-median split as faster", () => {
    render(<FieldComparison ladder={[row({ deltaMs: 0 })]} rank={1} fieldSize={4} />);
    expect(screen.getByText(/Faster than median at 0\/1/)).toBeInTheDocument();
  });

  it("calls out station wins, singular and plural", () => {
    const { unmount } = render(
      <FieldComparison ladder={[row({ best: true })]} rank={1} fieldSize={4} />,
    );
    expect(screen.getByText("1 station won")).toBeInTheDocument();
    unmount();

    render(
      <FieldComparison
        ladder={[row({ id: "a", best: true }), row({ id: "b", best: true })]}
        rank={1}
        fieldSize={4}
      />,
    );
    expect(screen.getByText("2 stations won")).toBeInTheDocument();
  });

  it("says nothing about station wins when there are none", () => {
    render(<FieldComparison ladder={[row()]} rank={1} fieldSize={4} />);
    expect(screen.queryByText(/stations won/)).not.toBeInTheDocument();
  });

  it("shows where the split placed at that station", () => {
    render(
      <FieldComparison ladder={[row({ place: 2, fieldCount: 16 })]} rank={1} fieldSize={16} />,
    );
    expect(screen.getByText("2nd/16")).toBeInTheDocument();
  });

  it("uses th for the teens", () => {
    render(
      <FieldComparison ladder={[row({ place: 11, fieldCount: 16 })]} rank={1} fieldSize={16} />,
    );
    expect(screen.getByText("11th/16")).toBeInTheDocument();
  });

  it("omits the place when the athlete has no split there", () => {
    render(
      <FieldComparison
        ladder={[row({ ms: 1_000 }), row({ id: "b", ms: null, deltaMs: null, place: null })]}
        rank={1}
        fieldSize={16}
      />,
    );
    expect(screen.queryAllByText(/\/8$/)).toHaveLength(1);
  });

  it("labels the gap in words rather than arrows", () => {
    render(
      <FieldComparison
        ladder={[row({ deltaMs: -1_000 }), row({ id: "b", deltaMs: 1_000 })]}
        rank={1}
        fieldSize={16}
      />,
    );
    expect(screen.getByText("faster")).toBeInTheDocument();
    expect(screen.getByText("slower")).toBeInTheDocument();
  });

  it("lists a row per station, in the order given", () => {
    render(
      <FieldComparison
        ladder={[row({ id: "a", label: "SLED" }), row({ id: "b", label: "BEER" })]}
        rank={1}
        fieldSize={4}
      />,
    );
    const labels = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(labels[0]).toContain("SLED");
    expect(labels[1]).toContain("BEER");
  });

  it("formats each split time", () => {
    render(<FieldComparison ladder={[row({ ms: 63_450 })]} rank={1} fieldSize={4} />);
    expect(screen.getByText("1:03.45")).toBeInTheDocument();
  });

  it("shows an em dash for a station the player has no time at", () => {
    render(
      <FieldComparison
        ladder={[row({ id: "a" }), row({ id: "b", ms: null, deltaMs: null })]}
        rank={1}
        fieldSize={4}
      />,
    );
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("points the delta arrow down when faster and up when slower", () => {
    render(
      <FieldComparison
        ladder={[row({ id: "a", deltaMs: -1_500 }), row({ id: "b", deltaMs: 2_250 })]}
        rank={1}
        fieldSize={4}
      />,
    );
    expect(screen.getByText("▼01.50")).toBeInTheDocument();
    expect(screen.getByText("▲02.25")).toBeInTheDocument();
  });

  it("scales the bars against the slowest station, not the median", () => {
    const { container } = render(
      <FieldComparison
        ladder={[row({ id: "a", ms: 10_000 }), row({ id: "b", ms: 20_000 })]}
        rank={1}
        fieldSize={4}
      />,
    );
    const widths = [...container.querySelectorAll("li span span")].map(
      (el) => (el as HTMLElement).style.width,
    );
    expect(widths).toEqual(["50%", "100%"]);
  });

  it("keeps a very fast split visible with a minimum bar width", () => {
    const { container } = render(
      <FieldComparison
        ladder={[row({ id: "a", ms: 1 }), row({ id: "b", ms: 100_000 })]}
        rank={1}
        fieldSize={4}
      />,
    );
    const first = container.querySelector("li span span") as HTMLElement;
    expect(first.style.width).toBe("4%");
  });
});
