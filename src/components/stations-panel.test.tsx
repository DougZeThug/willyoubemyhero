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
vi.mock("@/hooks/use-event-bundle", () => ({
  useEventBundle: () => ({ bundle: bundle.current }),
}));

const EVENT = "00000000-0000-4000-8000-0000000000ff";

function station(id: string, name: string, order: number) {
  return {
    id,
    name,
    short_name: null,
    description: null,
    station_order: order,
    icon: null,
    split_enabled: true,
    penalty_amount_ms: 0,
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
