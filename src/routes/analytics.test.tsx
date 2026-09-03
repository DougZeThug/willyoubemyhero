// Does mocking lucide-react with simple stubs fix the two empty-splits tests?
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import AnalyticsPage from "./analytics";
import { EVENT_ID, makeBundle, makeStation } from "@/test/fixtures";

const useEventBundle = vi.fn();

vi.mock("@/hooks/use-event-bundle", () => ({
  useEventBundle: (...args: unknown[]) => useEventBundle(...args),
}));

vi.mock("@/lib/media.functions", () => ({
  listArchives: vi.fn(async () => []),
}));

vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    Link: (props: { to: string; children: ReactNode }) => (
      <a href={props.to}>{props.children}</a>
    ),
  };
});

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(() => ({ data: undefined })),
}));

// Stub the classic-runtime icon and chart libraries: their precompiled dists
// create elements through React.createElement, and a stubbed module cannot
// hand React an undefined element type.
vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const stubs: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(actual)) {
    if (typeof value === "function") {
      stubs[name] = (props: Record<string, unknown>) => (
        <svg data-lucide-stub={name} {...props} />
      );
    } else {
      stubs[name] = value;
    }
  }
  return stubs;
});

vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const stubs: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(actual)) {
    if (typeof value === "function") {
      stubs[name] = (props: Record<string, unknown>) => (
        <svg data-recharts-stub={name} {...props} />
      );
    } else {
      stubs[name] = value;
    }
  }
  return stubs;
});

vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactNode }) => <>{children}</>,
  };
});

function healthyBundle() {
  return makeBundle();
}

beforeEach(() => {
  useEventBundle.mockReset();
  useEventBundle.mockReturnValue({
    event: { id: EVENT_ID, name: "Draft Combine", year: 2026, active: true },
    bundle: healthyBundle(),
    loading: false,
    error: null,
    failedTables: [],
    realtimeDegraded: false,
    refetch: vi.fn(async () => {}),
  });
});

describe("AnalyticsPage station averages", () => {
  it("shows the split-read failure when only stations succeeded", async () => {
    useEventBundle.mockReturnValue({
      event: null,
      bundle: makeBundle({ failed: ["splits"] }),
      loading: false,
      error: null,
      failedTables: ["splits"],
      realtimeDegraded: false,
      refetch: vi.fn(async () => {}),
    });
    render(<AnalyticsPage />);
    await waitFor(() =>
      expect(
        screen.getByText("Couldn't read the splits just now — retrying."),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText("No split data yet.")).not.toBeInTheDocument();
  });

  it("says there is no split data yet when the read came back empty", () => {
    render(<AnalyticsPage />);
    expect(screen.getByText("No split data yet.")).toBeInTheDocument();
  });

  it("says there is no split data yet when stations exist but nobody has run", () => {
    useEventBundle.mockReturnValue({
      event: { id: EVENT_ID, name: "Draft Combine", year: 2026, active: true },
      bundle: makeBundle({
        stations: [makeStation({ name: "Sled Push", short_name: "SLED", station_order: 1 })],
      }),
      loading: false,
      error: null,
      failedTables: [],
      realtimeDegraded: false,
      refetch: vi.fn(async () => {}),
    });
    render(<AnalyticsPage />);
    expect(screen.getByText("No split data yet.")).toBeInTheDocument();
  });
});
