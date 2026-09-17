// The batch queue's bookkeeping across a rebuild.
//
// CardPromptBatch is rendered directly rather than through the studio: the
// defect is entirely in what survives build(), and reaching it through the
// studio would mean driving a template load and a series picker first.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CardPromptBatch } from "./card-prompt-tools";
import type { PromptStudioBundle } from "./card-prompt-studio";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

const serverFnMock = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => serverFnMock,
}));

const bundle: PromptStudioBundle = {
  participants: [
    {
      id: "event-participant",
      participant_id: "person",
      participant: { name: "Alex", nickname: "Ace" },
    },
  ],
  stations: [{ id: "station", name: "Sprint", short_name: null, station_order: 1 }],
  runs: [{ id: "run", participant_id: "person", official_time_ms: 12500, is_official: true }],
  splits: [{ run_id: "run", station_id: "station", segment_time_ms: 5000 }],
};

function renderBatch() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CardPromptBatch
        eventId="event"
        eventName="Combine"
        bundle={bundle}
        photoUrls={undefined}
        templates={[]}
        templatesReady
      />
    </QueryClientProvider>,
  );
}

/** Every history write the batch has asked for. */
function initialSaves() {
  return serverFnMock.mock.calls.filter(([value]) => value?.data?.kind === "initial");
}

describe("CardPromptBatch", () => {
  beforeEach(() => {
    serverFnMock.mockReset().mockResolvedValue({ id: "history-id" });
  });

  it("still records a rebuilt prompt when the previous batch's save comes back late", async () => {
    // `saved` and the in-flight claim both outlive a single batch, and build()
    // clears them — but the copy still waiting on its write holds the Map and
    // the Set themselves. Its late write landed in the REBUILT batch's
    // bookkeeping, and because item keys are stable across builds the next copy
    // read "already saved" and skipped the history row for a prompt the rebuild
    // had changed. The copy reported success either way, so the row was simply
    // missing from Recent Prompts.
    let resolveSave!: (value: { id: string }) => void;
    const pending = new Promise<{ id: string }>((resolve) => (resolveSave = resolve));
    serverFnMock.mockImplementationOnce(() => pending);

    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    renderBatch();

    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Build Batch" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy Prompt" }));
    await waitFor(() => expect(initialSaves()).toHaveLength(1));

    // The commissioner changes the shared notes and rebuilds while that write
    // is still out, so the queued prompt for this player is a different one.
    await user.type(screen.getByLabelText(/shared/i), "gold trim");
    await user.click(screen.getByRole("button", { name: "Build Batch" }));

    resolveSave({ id: "first-batch-row" });
    await waitFor(() => expect(initialSaves()).toHaveLength(1));

    fireEvent.click(screen.getByRole("button", { name: "Copy Prompt" }));

    await waitFor(() => expect(initialSaves()).toHaveLength(2));
    expect(initialSaves()[1]?.[0]?.data?.generatedPrompt).toContain("gold trim");
  });

  it("still copies the same item only once within one batch", async () => {
    // The guard the rebuild fix must not undo: two clicks before React commits
    // the disabled button still write one row.
    let resolveSave!: (value: { id: string }) => void;
    const pending = new Promise<{ id: string }>((resolve) => (resolveSave = resolve));
    serverFnMock.mockImplementationOnce(() => pending);

    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    renderBatch();

    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Build Batch" }));
    const copy = screen.getByRole("button", { name: "Copy Prompt" });
    fireEvent.click(copy);
    fireEvent.click(copy);

    await waitFor(() => expect(initialSaves()).toHaveLength(1));
    resolveSave({ id: "row" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Copy Prompt" })).toBeEnabled());
    expect(initialSaves()).toHaveLength(1);
  });
});
