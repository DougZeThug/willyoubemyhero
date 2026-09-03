import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    Link: ({ to, children }: { to?: string; children?: React.ReactNode }) => (
      <a href={to}>{children}</a>
    ),
  };
});
vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useQuery: () => ({ data: undefined }) };
});
vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});
vi.mock("@/hooks/use-event-bundle", () => ({
  useEventBundle: () => ({
    event: null,
    bundle: { stations: [], runs: [], splits: [], participants: [], failed: [] },
    loading: false,
    error: null,
    failedTables: ["splits"],
    realtimeDegraded: false,
    refetch: () => {},
  }),
}));

import AnalyticsPage from "@/routes/analytics";

describe("probe", () => {
  it("renders the page with failed splits", () => {
    let caught: unknown = null;
    try {
      render(<AnalyticsPage />);
    } catch (e) {
      caught = e;
      console.log("CAUGHT:", (e as Error).stack);
    }
    expect(caught).toBeNull();
  });
});
