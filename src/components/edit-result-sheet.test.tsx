/**
 * The sheet's arithmetic is the part admins trust while standing in a garden:
 * the total has to follow the splits they just typed, and stop following them
 * the moment they type a course time themselves.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditResultSheet } from "./edit-result-sheet";

const serverFnMock = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => serverFnMock,
}));

const bundle = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock("@/hooks/use-event-bundle", () => ({
  useEventBundle: () => ({ bundle: bundle.current }),
}));

const EVENT = "00000000-0000-4000-8000-0000000000ff";
const PLAYER = "00000000-0000-4000-8000-0000000000aa";

function station(id: string, short: string, order: number) {
  return {
    id,
    name: short,
    short_name: short,
    description: null,
    station_order: order,
    icon: null,
    split_enabled: true,
    penalty_amount_ms: 0,
    active: true,
  };
}

function renderSheet() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <EditResultSheet
        eventId={EVENT}
        participantId={PLAYER}
        participantName="Isaiah Ament"
        open
        onOpenChange={() => {}}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  serverFnMock.mockReset().mockResolvedValue({ ok: true });
  bundle.current = {
    stations: [station("a", "FLIP", 1), station("b", "CORN", 2)],
    runs: [],
    splits: [],
    penalties: [],
  };
});

describe("EditResultSheet", () => {
  it("fills the course time from the splits as they are typed", async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.type(screen.getByLabelText("FLIP split"), "15.00");
    await user.type(screen.getByLabelText("CORN split"), "40.00");

    const course = screen.getByLabelText(/course time/i) as HTMLInputElement;
    await waitFor(() => expect(course.value).toBe("40.00"));
    expect(screen.getByText("40.00")).toBeInTheDocument();
  });

  it("shows each station's leg time", async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.type(screen.getByLabelText("FLIP split"), "15.00");
    await user.type(screen.getByLabelText("CORN split"), "40.00");

    expect(screen.getByText("+15.00")).toBeInTheDocument();
    expect(screen.getByText("+25.00")).toBeInTheDocument();
  });

  it("flags a split that goes backwards", async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.type(screen.getByLabelText("FLIP split"), "40.00");
    await user.type(screen.getByLabelText("CORN split"), "15.00");

    expect(screen.getByText("out of order")).toBeInTheDocument();
  });

  it("lets a typed course time win over the splits", async () => {
    const user = userEvent.setup();
    renderSheet();

    const course = screen.getByLabelText(/course time/i) as HTMLInputElement;
    await user.type(course, "1:00.00");
    await user.type(screen.getByLabelText("FLIP split"), "15.00");

    expect(course.value).toBe("1:00.00");
    expect(screen.getByText(/from splits/i)).toBeInTheDocument();
  });

  it("adds penalties on top of the split-derived time", async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.type(screen.getByLabelText("FLIP split"), "40.00");
    await user.click(screen.getByRole("button", { name: /add/i }));

    await waitFor(() => expect(screen.getByText("45.00")).toBeInTheDocument());
  });
});
