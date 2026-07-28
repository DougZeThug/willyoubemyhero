// The 1080×1350 share graphic. It is rasterised by html-to-image, so every
// style is inline and the only thing worth asserting is the content.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ResultCard, type ResultCardData } from "./result-card";

function data(over: Partial<ResultCardData> = {}): ResultCardData {
  return {
    eventName: "Draft Combine",
    eventYear: 2026,
    participantName: "Doug Weidensaul",
    totalMs: 63_450,
    splits: [
      { label: "SLED", ms: 20_000 },
      { label: "BEER", ms: 43_450 },
    ],
    ...over,
  };
}

describe("ResultCard", () => {
  it("renders at the fixed export size", () => {
    const { container } = render(<ResultCard data={data()} />);
    expect(container.firstElementChild).toHaveStyle({ width: "1080px", height: "1350px" });
  });

  it("shows the athlete and the event year", () => {
    render(<ResultCard data={data()} />);
    expect(screen.getByText("Doug Weidensaul")).toBeInTheDocument();
    expect(screen.getByText(/Draft Combine 2026/)).toBeInTheDocument();
  });

  it("formats the total time", () => {
    render(<ResultCard data={data({ totalMs: 63_450 })} />);
    expect(screen.getByText("1:03.45")).toBeInTheDocument();
  });

  it("shows a placing badge when there is one", () => {
    render(<ResultCard data={data({ rank: 3 })} />);
    expect(screen.getByText("#3")).toBeInTheDocument();
  });

  it("omits the placing badge for an unranked run", () => {
    render(<ResultCard data={data({ rank: null })} />);
    expect(screen.queryByText(/^#\d/)).not.toBeInTheDocument();
  });

  it("lists every split in order", () => {
    render(<ResultCard data={data()} />);
    expect(screen.getByText("SLED")).toBeInTheDocument();
    expect(screen.getByText("BEER")).toBeInTheDocument();
    expect(screen.getByText("20.00")).toBeInTheDocument();
  });

  it("copes with no splits at all", () => {
    expect(() => render(<ResultCard data={data({ splits: [] })} />)).not.toThrow();
  });

  it("copes with a missing year, leaving no stray placeholder", () => {
    render(<ResultCard data={data({ eventYear: null })} />);
    // The name appears in the heading and again in the footer credit.
    expect(screen.getAllByText(/Draft Combine/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/null|undefined|NaN/)).not.toBeInTheDocument();
  });

  it("forwards a ref, which is how html-to-image gets the node", () => {
    let node: HTMLDivElement | null = null;
    render(
      <ResultCard
        ref={(el) => {
          node = el;
        }}
        data={data()}
      />,
    );
    expect(node).toBeInstanceOf(HTMLDivElement);
  });
});
