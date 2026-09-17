// The draw, and the one thing it must refuse to draw.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import OrderPage from "./order";
import { EVENT_ID, makeBundle, makeParticipant, resetFixtureIds } from "@/test/fixtures";

const useEventBundle = vi.fn();
const useAdminSession = vi.fn();
const setRunningOrder = vi.fn(async () => ({ ok: true }));
const recordRandomization = vi.fn(async () => ({ ok: true }));

vi.mock("@/hooks/use-event-bundle", () => ({
  useEventBundle: (...args: unknown[]) => useEventBundle(...args),
}));

vi.mock("@/hooks/use-photo-urls", () => ({
  useEventPhotoUrls: () => ({ data: {} }),
  useEventCardUrls: () => ({ data: {} }),
}));

vi.mock("@/lib/admin-token", () => ({
  useAdminSession: () => useAdminSession(),
}));

vi.mock("@/lib/admin-write.functions", () => ({
  setRunningOrder: (...args: unknown[]) => setRunningOrder(...(args as [])),
  recordRandomization: (...args: unknown[]) => recordRandomization(...(args as [])),
}));

vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn(async () => {}) }),
}));

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    Link: (props: { to: string; children: ReactNode }) => <a href={props.to}>{props.children}</a>,
  };
});

vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const stubs: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(actual)) {
    stubs[name] =
      typeof value === "function"
        ? (props: Record<string, unknown>) => <svg data-lucide-stub={name} {...props} />
        : value;
  }
  return stubs;
});

/** The page as an admin sees it, with whatever roster the case needs. */
function asAdminWith(
  participants: ReturnType<typeof makeParticipant>[],
  failedTables: string[] = [],
) {
  useAdminSession.mockReturnValue({ eventId: EVENT_ID, expiresAt: Date.now() + 60_000, token: "t" });
  useEventBundle.mockReturnValue({
    event: { id: EVENT_ID, name: "Draft Combine", year: 2026, active: true },
    bundle: makeBundle({ participants, failed: failedTables }),
    loading: false,
    error: null,
    failedTables,
    realtimeDegraded: false,
    refetch: vi.fn(async () => {}),
  });
}

const reRandomize = () => screen.getByRole("button", { name: /re-randomize/i });

beforeEach(() => {
  resetFixtureIds();
  useEventBundle.mockReset();
  useAdminSession.mockReset();
  setRunningOrder.mockClear();
  recordRandomization.mockClear();
});

describe("re-randomizing an empty field", () => {
  it("offers no shuffle when there is no roster to shuffle", () => {
    // The page renders its own "No roster yet" state and used to put an armed
    // Re-randomize button directly above it.
    asAdminWith([]);
    render(<OrderPage />);
    expect(screen.getByText("No roster yet. The commissioner sets the field.")).toBeInTheDocument();
    expect(reRandomize()).toBeDisabled();
  });

  it("writes nothing when the roster read is the thing that failed", async () => {
    // The sharper case: a failed read looks exactly like an empty roster from
    // here, so a shuffle would write an empty order over a field that exists.
    asAdminWith([], ["event_participants"]);
    render(<OrderPage />);
    expect(screen.getByText("Couldn't read the roster just now — retrying.")).toBeInTheDocument();
    await userEvent.click(reRandomize(), { pointerEventsCheck: 0 });
    expect(setRunningOrder).not.toHaveBeenCalled();
    expect(recordRandomization).not.toHaveBeenCalled();
  });

  it("still shuffles a field that has someone in it", async () => {
    asAdminWith([
      makeParticipant({ participant: { id: "p-a", name: "Alice Ace", nickname: null } }),
      makeParticipant({
        running_order: 2,
        participant: { id: "p-b", name: "Bob Bison", nickname: null },
      }),
    ]);
    render(<OrderPage />);
    expect(reRandomize()).toBeEnabled();
    await userEvent.click(reRandomize());
    expect(setRunningOrder).toHaveBeenCalledOnce();
    expect(recordRandomization).toHaveBeenCalledOnce();
  });
});
