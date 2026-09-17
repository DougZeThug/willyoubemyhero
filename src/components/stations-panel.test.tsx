import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { StationsPanel } from "./stations-panel";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

const serverFnMock = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => serverFnMock,
}));

const bundle = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));
const failedTables = vi.hoisted(() => ({ current: [] as string[] }));
vi.mock("@/hooks/use-event-bundle", () => ({
  // `failedTables` matters here: the panel refuses a delete when it cannot tell
  // whether the station has recorded times, and an empty list is only
  // trustworthy when the read succeeded.
  useEventBundle: () => ({ bundle: bundle.current, failedTables: failedTables.current }),
}));

const EVENT = "00000000-0000-4000-8000-0000000000ff";

function station(id: string, name: string, order: number, penaltyMs = 0) {
  return {
    id,
    name,
    short_name: null,
    description: null,
    station_order: order,
    icon: null,
    split_enabled: true,
    penalty_amount_ms: penaltyMs,
    active: true,
  };
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <StationsPanel eventId={EVENT} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  serverFnMock.mockReset().mockResolvedValue({ ok: true });
  bundle.current = {
    stations: [station("a", "Sprint", 1), station("b", "Tire Flip", 2)],
    runs: [],
    splits: [],
    penalties: [],
  };
  failedTables.current = [];
});

describe("StationsPanel", () => {
  it("hides the move arrows until rearranging is turned on", async () => {
    renderPanel();
    expect(screen.queryByLabelText("Move Sprint down")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /rearrange/i }));
    expect(screen.getByLabelText("Move Sprint down")).toBeTruthy();
  });

  it("swaps the sort order of two stations in one atomic call", async () => {
    renderPanel();
    await userEvent.click(screen.getByRole("button", { name: /rearrange/i }));
    await userEvent.click(screen.getByLabelText("Move Sprint down"));

    await waitFor(() => expect(serverFnMock).toHaveBeenCalledTimes(1));
    expect(serverFnMock.mock.calls[0][0].data).toMatchObject({ aId: "a", bId: "b" });
  });

  it("renames a station through the edit sheet", async () => {
    renderPanel();
    await userEvent.click(screen.getByRole("button", { name: /Sprint/ }));
    const name = await screen.findByLabelText("Name");
    await userEvent.clear(name);
    await userEvent.type(name, "Sled Push");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(serverFnMock).toHaveBeenCalled());
    expect(serverFnMock.mock.calls[0][0].data).toMatchObject({
      id: "a",
      name: "Sled Push",
      eventId: EVENT,
    });
  });

  it("refuses to delete a station that already has recorded times", async () => {
    bundle.current = {
      ...bundle.current,
      splits: [{ station_id: "a" }],
    };
    renderPanel();
    await userEvent.click(screen.getByRole("button", { name: /Sprint/ }));
    await userEvent.click(await screen.findByLabelText("Delete station"));

    expect(serverFnMock).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("switch it to inactive instead"),
    );
  });
});

describe("StationsPanel bulk rename", () => {
  it("writes only the rows whose names changed", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: /rename all/i }));

    const nameField = screen.getByLabelText("Sprint name");
    await user.clear(nameField);
    await user.type(nameField, "Dash");
    await user.type(screen.getByLabelText("Sprint short name"), "DASH");

    await user.click(screen.getByRole("button", { name: /save all names/i }));

    await waitFor(() => expect(serverFnMock).toHaveBeenCalledTimes(1));
    expect(serverFnMock.mock.calls[0]?.[0]?.data).toMatchObject({
      id: "a",
      name: "Dash",
      short_name: "DASH",
    });
    expect(toast.success).toHaveBeenCalled();
  });

  it("refuses a blank name", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: /rename all/i }));
    await user.clear(screen.getByLabelText("Sprint name"));
    await user.click(screen.getByRole("button", { name: /save all names/i }));

    expect(serverFnMock).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Every station needs a name");
  });
});

describe("StationsPanel when the times cannot be read", () => {
  it("refuses a delete rather than trusting an empty splits list", async () => {
    // getEventBundle coalesces a failed table read to an empty array, so the
    // "this station has recorded times" guard came off at exactly the moment
    // the times could not be seen — and the delete cascades every split at it.
    failedTables.current = ["splits"];
    renderPanel();
    await userEvent.click(screen.getByRole("button", { name: /Sprint/ }));
    await userEvent.click(await screen.findByLabelText("Delete station"));

    expect(serverFnMock).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/can't read/i));
  });
});

describe("StationsPanel penalties", () => {
  /** Sprint carries a 2.5s penalty; everything else is as the suite leaves it. */
  function withSubSecondPenalty() {
    bundle.current = {
      ...bundle.current,
      stations: [station("a", "Sprint", 1, 2_500), station("b", "Tire Flip", 2)],
    };
  }

  it("shows the penalty that will actually be applied, not a rounded one", () => {
    // The console's own penalty button labels itself with formatTime, so a list
    // rounding 2500ms to "+3s" disagreed with the button that applies it.
    withSubSecondPenalty();
    renderPanel();
    expect(screen.getByRole("button", { name: /Sprint/ })).toHaveTextContent("+02.50 pen");
  });

  it("keeps a sub-second penalty across a save that never touched it", async () => {
    // The drift. The draft used to round 2500ms to 3 seconds on the way in, so
    // opening a station to change its NAME and pressing Save rewrote the
    // penalty to 3000ms — silently, and only once, which is what made it hard
    // to catch.
    withSubSecondPenalty();
    renderPanel();
    await userEvent.click(screen.getByRole("button", { name: /Sprint/ }));
    const name = await screen.findByLabelText("Name");
    await userEvent.clear(name);
    await userEvent.type(name, "Sled Push");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(serverFnMock).toHaveBeenCalled());
    expect(serverFnMock.mock.calls[0][0].data).toMatchObject({
      name: "Sled Push",
      penalty_amount_ms: 2_500,
    });
  });

  it("keeps it across a bulk rename too", async () => {
    // Same round trip, reached from the other side: renaming every station at
    // once routes through the same draft, so it drifted every penalty it saw.
    withSubSecondPenalty();
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: /rename all/i }));
    const field = screen.getByLabelText("Sprint name");
    await user.clear(field);
    await user.type(field, "Dash");
    await user.click(screen.getByRole("button", { name: /save all names/i }));

    await waitFor(() => expect(serverFnMock).toHaveBeenCalledTimes(1));
    expect(serverFnMock.mock.calls[0][0].data).toMatchObject({
      name: "Dash",
      penalty_amount_ms: 2_500,
    });
  });

  it("stores the sub-second penalty an admin types", async () => {
    renderPanel();
    await userEvent.click(screen.getByRole("button", { name: /Sprint/ }));
    const pen = await screen.findByLabelText("Penalty");
    await userEvent.type(pen, "2.5");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(serverFnMock).toHaveBeenCalled());
    expect(serverFnMock.mock.calls[0][0].data).toMatchObject({ penalty_amount_ms: 2_500 });
  });

  it("refuses a penalty it cannot read rather than storing nothing", async () => {
    // Quietly saving 0 would drop the penalty entirely, and a station's penalty
    // is applied at the push of a button in the timing console.
    renderPanel();
    await userEvent.click(screen.getByRole("button", { name: /Sprint/ }));
    await userEvent.type(await screen.findByLabelText("Penalty"), "two and a bit");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(serverFnMock).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/must be a time/i));
  });

  it("reads a blank box as no penalty", async () => {
    withSubSecondPenalty();
    renderPanel();
    await userEvent.click(screen.getByRole("button", { name: /Sprint/ }));
    await userEvent.clear(await screen.findByLabelText("Penalty"));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(serverFnMock).toHaveBeenCalled());
    expect(serverFnMock.mock.calls[0][0].data).toMatchObject({ penalty_amount_ms: 0 });
  });
});
