/**
 * The sheet's arithmetic is the part admins trust while standing in a garden:
 * each box is that station's own time, the running clock beside it and the
 * official total have to follow every keystroke, and a typed course time has to
 * stop them following.
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
    stations: [station("a", "FLIP", 1), station("b", "CORN", 2), station("c", "PONG", 3)],
    runs: [],
    splits: [],
    penalties: [],
  };
});

describe("EditResultSheet", () => {
  it("adds the station times up into the course time", async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.type(screen.getByLabelText("FLIP time"), "15.00");
    await user.type(screen.getByLabelText("CORN time"), "25.00");

    const course = screen.getByLabelText(/course time/i) as HTMLInputElement;
    await waitFor(() => expect(course.value).toBe("40.00"));
  });

  it("shows the running clock beside each station", async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.type(screen.getByLabelText("FLIP time"), "15.00");
    await user.type(screen.getByLabelText("CORN time"), "25.00");

    expect(screen.getByText("at 15.00")).toBeInTheDocument();
    expect(screen.getByText("at 40.00")).toBeInTheDocument();
  });

  it("moves every later station when a middle one is corrected", async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.type(screen.getByLabelText("FLIP time"), "15.00");
    await user.type(screen.getByLabelText("CORN time"), "25.00");
    await user.type(screen.getByLabelText("PONG time"), "10.00");

    await user.clear(screen.getByLabelText("CORN time"));
    await user.type(screen.getByLabelText("CORN time"), "35.00");

    expect(screen.getByText("at 15.00")).toBeInTheDocument();
    expect(screen.getByText("at 50.00")).toBeInTheDocument();
    expect(screen.getByText("at 1:00.00")).toBeInTheDocument();
    const course = screen.getByLabelText(/course time/i) as HTMLInputElement;
    await waitFor(() => expect(course.value).toBe("1:00.00"));
  });

  it("skips blank stations in the running clock", async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.type(screen.getByLabelText("FLIP time"), "15.00");
    await user.type(screen.getByLabelText("PONG time"), "10.00");

    expect(screen.getByText("at 25.00")).toBeInTheDocument();
  });

  it("lets a typed course time win over the stations", async () => {
    const user = userEvent.setup();
    renderSheet();

    const course = screen.getByLabelText(/course time/i) as HTMLInputElement;
    await user.type(course, "1:00.00");
    await user.type(screen.getByLabelText("FLIP time"), "15.00");

    expect(course.value).toBe("1:00.00");
    expect(screen.getByText(/from splits/i)).toBeInTheDocument();
  });

  it("adds penalties on top of the station total", async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.type(screen.getByLabelText("FLIP time"), "40.00");
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(screen.getByText("45.00")).toBeInTheDocument());
  });

  it("saves cumulative splits, not the per-station times", async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.type(screen.getByLabelText("FLIP time"), "15.00");
    await user.type(screen.getByLabelText("CORN time"), "25.00");
    await user.click(screen.getByRole("button", { name: /add result/i }));

    await waitFor(() => expect(serverFnMock).toHaveBeenCalled());
    expect(serverFnMock.mock.calls[0]?.[0].data.splits).toEqual([
      { stationId: "a", cumulative_time_ms: 15000 },
      { stationId: "b", cumulative_time_ms: 40000 },
    ]);
  });

  it("re-saves an existing result without shaving time off it", async () => {
    // Opening a result and saving it untouched used to drift down a hundredth
    // per leg, because the boxes were seeded from a truncating formatter.
    bundle.current = {
      ...bundle.current,
      runs: [{ id: "run-1", participant_id: PLAYER, is_official: true, raw_time_ms: 101_320 }],
      splits: [
        { run_id: "run-1", station_id: "a", cumulative_time_ms: 15_350 },
        { run_id: "run-1", station_id: "b", cumulative_time_ms: 53_560 },
        { run_id: "run-1", station_id: "c", cumulative_time_ms: 101_320 },
      ],
      penalties: [],
    };
    const user = userEvent.setup();
    renderSheet();

    const course = screen.getByLabelText(/course time/i) as HTMLInputElement;
    await waitFor(() => expect(course.value).toBe("1:41.32"));

    await user.click(screen.getByRole("button", { name: /save result/i }));
    await waitFor(() => expect(serverFnMock).toHaveBeenCalled());
    const sent = serverFnMock.mock.calls[0]?.[0].data;
    expect(sent.raw_time_ms).toBe(101_320);
    expect(sent.splits).toEqual([
      { stationId: "a", cumulative_time_ms: 15_350 },
      { stationId: "b", cumulative_time_ms: 53_560 },
      { stationId: "c", cumulative_time_ms: 101_320 },
    ]);
  });
});

