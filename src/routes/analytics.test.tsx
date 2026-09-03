// The three states the analytics screen can land in once the splits read comes
// back: failed, legitimately empty, and stations-with-no-finishes. Regression
// coverage for the stationAverages gate — the card used to render zero-value
// bars over a failed read instead of saying so.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { guardedModule } from "@/test/jsx-guard";
import AnalyticsPage from "./analytics";
import { EVENT_ID, makeBundle, makeStation } from "@/test/fixtures";

const useEventBundle = vi.fn();

vi.mock("@/hooks/use-event-bundle", () => ({
  useEventBundle: (...args: unknown[]) => useEventBundle(...args),
}));

vi.mock("@/lib/media.functions", () => ({
  listArchives: vi.fn(async () => []),
}));

// useServerFn only exists to bind a server function to the router; in a test
// the function itself is already callable.
vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});

// The route imports createFileRoute and Link from the router; keep the real
// exports and only stub the pieces that need a browser to exist.
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

// The charts need a viewport; jsdom gives them none, so let the container pass
// its children straight through while the real chart pieces stay intact.
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactNode }) => <>{children}</>,
  };
});

// Name the undefined element instead of letting React report only "got:
// undefined" — the guard logs the props every time the runtime is handed a
// null/undefined element type. The dev transform pulls the dev runtime.
vi.mock("react/jsx-runtime", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return guardedModule(actual);
});
vi.mock("react/jsx-dev-runtime", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return guardedModule(actual);
});
vi.mock("react/jsx-dev-runtime", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return guardedModule(actual);
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
