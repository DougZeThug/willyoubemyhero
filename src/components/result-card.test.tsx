// The 1080×1350 share graphic. It is rasterised by html-to-image, so every
// style is inline and the only thing worth asserting is the content.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ResultCard, type ResultCardData } from "./result-card";
import { shareResultLayout } from "@/lib/share-result-layout";

function data(over: Partial<ResultCardData> = {}): ResultCardData {
  return {
    eventName: "Draft Combine",
    eventYear: 2026,
    participantName: "Doug Weidensaul",
    totalMs: 63_450,
    splits: [
      { id: "split-1", label: "SLED", ms: 20_000 },
      { id: "split-2", label: "BEER", ms: 43_450 },
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

  it("lists two splits that share a name, each on its own row", () => {
    // Station names may repeat within an event, and every split whose station
    // cannot be found is labelled "Split" — so the label cannot be what tells the
    // rows apart. Duplicate keys make React's reconciliation undefined.
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <ResultCard
        data={data({
          splits: [
            { id: "split-1", label: "Split", ms: 20_000 },
            { id: "split-2", label: "Split", ms: 43_450 },
          ],
        })}
      />,
    );
    expect(screen.getAllByText("Split")).toHaveLength(2);
    expect(screen.getByText("20.00")).toBeInTheDocument();
    expect(screen.getByText("43.45")).toBeInTheDocument();
    const duplicateKey = error.mock.calls.some((c) => String(c[0]).includes("same key"));
    error.mockRestore();
    expect(duplicateKey).toBe(false);
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

  describe("on a long course", () => {
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `split-${i}`,
        label: `STATION ${i + 1}`,
        ms: 10_000 + i,
      }));

    it("draws all thirteen splits and still ends on the footer", () => {
      // The grid used to run past the canvas and clip the last rows and then the
      // footer credit. The height itself is pinned in share-result-layout.test.ts.
      const { container } = render(<ResultCard data={data({ splits: many(13) })} />);
      for (let i = 1; i <= 13; i++) expect(screen.getByText(`STATION ${i}`)).toBeInTheDocument();
      expect(screen.queryByText(/more$/)).not.toBeInTheDocument();
      const root = container.firstElementChild!;
      expect(root.lastElementChild).toHaveTextContent("willyoubemyhero.com · Draft Combine");
    });

    it("says how many it left off when even the tightest grid cannot hold them", () => {
      render(<ResultCard data={data({ splits: many(18), penaltyMs: 5_000 })} />);
      const left = shareResultLayout(18, true);
      expect(left.hidden).toBeGreaterThan(0);
      expect(screen.getAllByText(/^STATION /)).toHaveLength(left.shown);
      expect(screen.getByText(`…and ${left.hidden} more`)).toBeInTheDocument();
      expect(screen.getByText(/willyoubemyhero\.com/)).toBeInTheDocument();
    });

    it("sets the grid from the layout, so the budget is what is drawn", () => {
      const { container } = render(<ResultCard data={data({ splits: many(13) })} />);
      const layout = shareResultLayout(13, false);
      const grid = screen.getByText("STATION 1").parentElement!.parentElement!;
      expect(grid).toHaveStyle({
        gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))`,
        gridAutoRows: `${layout.rowH}px`,
      });
      expect(container.firstElementChild).toHaveStyle({ height: "1350px" });
    });
  });
});
