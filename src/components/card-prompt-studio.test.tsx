import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { CardPromptStudio, type PromptStudioBundle } from "./card-prompt-studio";
import { formatKnownPerformanceData } from "@/lib/card-prompt-data";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => vi.fn().mockResolvedValue({ templates: [], runs: [], id: "history-id" }),
}));

function renderStudio(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

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

describe("formatKnownPerformanceData", () => {
  it("uses the underlying participant id and formats player data", () => {
    expect(formatKnownPerformanceData(bundle, "person")).toContain("Best official time: 12.50");
    expect(formatKnownPerformanceData(bundle, "event-participant")).toContain(
      "Official run: unavailable",
    );
  });

  it("does not turn missing performance data into zeroes", () => {
    const empty = { ...bundle, runs: [], splits: [] };
    const output = formatKnownPerformanceData(empty, "person");
    expect(output).toContain("unavailable");
    expect(output).not.toContain("00.00");
  });
});

describe("CardPromptStudio", () => {
  beforeEach(() => {
    HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
    HTMLElement.prototype.setPointerCapture = vi.fn();
    HTMLElement.prototype.releasePointerCapture = vi.fn();
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it("generates and copies a player prompt and revision", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    renderStudio(
      <CardPromptStudio
        eventId="event"
        eventName="Combine"
        bundle={bundle}
        photoUrls={{ "event-participant": "https://example.test/alex.jpg" }}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "Participant" }));
    await user.click(screen.getByRole("option", { name: /Alex/ }));
    await user.click(screen.getByRole("button", { name: "Generate prompt" }));
    const preview = screen.getByLabelText("Generated prompt preview") as HTMLTextAreaElement;
    expect(preview.value).toContain("Rank: 1 of 1");
    expect(preview.value).toContain("Nickname: Ace");
    await user.click(screen.getByRole("button", { name: "Copy prompt" }));
    expect(writeText).toHaveBeenCalledWith(preview.value);
    expect(toast.success).toHaveBeenCalledWith("Prompt copied");

    await user.type(screen.getByLabelText("Revision instructions"), "Change the headline.");
    await user.click(screen.getByRole("button", { name: "Copy revision prompt" }));
    expect(writeText).toHaveBeenLastCalledWith(
      expect.stringContaining("CHANGE ONLY THE FOLLOWING"),
    );
  });

  it("switches to a secret series and requires subject plus association", async () => {
    const user = userEvent.setup();
    renderStudio(
      <CardPromptStudio
        eventId="event"
        eventName="Combine"
        bundle={bundle}
        photoUrls={undefined}
      />,
    );
    await user.click(screen.getByRole("combobox", { name: "Series" }));
    await user.click(screen.getByRole("option", { name: "Secret Pet" }));
    expect(screen.queryByRole("combobox", { name: "Participant" })).not.toBeInTheDocument();
    const generate = screen.getByRole("button", { name: "Generate prompt" });
    expect(generate).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Subject name"), { target: { value: "Pickles" } });
    fireEvent.change(screen.getByLabelText("Owner / association"), { target: { value: "Maya" } });
    await waitFor(() => expect(generate).toBeEnabled());
    await user.click(generate);
    expect(
      (screen.getByLabelText("Generated prompt preview") as HTMLTextAreaElement).value,
    ).toContain("Subject name: Pickles");
  });

  it("falls back to a participant profile image", async () => {
    const user = userEvent.setup();
    const profileBundle: PromptStudioBundle = {
      ...bundle,
      participants: [
        {
          ...bundle.participants[0],
          participant: {
            name: "Alex",
            nickname: "Ace",
            profile_image_url: "https://example.test/profile.jpg",
          },
        },
      ],
    };
    renderStudio(
      <CardPromptStudio
        eventId="event"
        eventName="Combine"
        bundle={profileBundle}
        photoUrls={undefined}
      />,
    );
    await user.click(screen.getByRole("combobox", { name: "Participant" }));
    await user.click(screen.getByRole("option", { name: /Alex/ }));
    expect(screen.getByRole("img", { name: "Alex reference" })).toHaveAttribute(
      "src",
      "https://example.test/profile.jpg",
    );
  });

  it("binds revision instructions to the generated subject snapshot", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    const twoPlayers: PromptStudioBundle = {
      ...bundle,
      participants: [
        ...bundle.participants,
        {
          id: "event-participant-2",
          participant_id: "person-2",
          participant: { name: "Blake", nickname: null },
        },
      ],
    };
    renderStudio(
      <CardPromptStudio
        eventId="event"
        eventName="Combine"
        bundle={twoPlayers}
        photoUrls={undefined}
      />,
    );
    await user.click(screen.getByRole("combobox", { name: "Participant" }));
    await user.click(screen.getByRole("option", { name: /Alex/ }));
    await user.click(screen.getByRole("button", { name: "Generate prompt" }));
    await user.click(screen.getByRole("combobox", { name: "Participant" }));
    await user.click(screen.getByRole("option", { name: "Blake" }));
    await user.type(screen.getByLabelText("Revision instructions"), "Change one detail.");
    await user.click(screen.getByRole("button", { name: "Copy revision prompt" }));
    expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining("card for Alex"));
    expect(writeText).not.toHaveBeenLastCalledWith(expect.stringContaining("card for Blake"));
  });
});
