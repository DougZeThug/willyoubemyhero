// What happens to the previews of the files that are leaving the list.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { CardBulkUpload } from "./card-bulk-upload";

const bulkUpload = vi.fn();

vi.mock("@/lib/media.functions", () => ({
  uploadParticipantCardsBulk: (...args: unknown[]) => bulkUpload(...(args as [])),
}));

vi.mock("@/lib/image-encode", () => ({
  // The real one copies the bytes through arrayBuffer; the copy is not what is
  // under test and keeping the same File keeps its name, which is how the
  // assertions below tell one staged preview from another.
  snapshotFile: vi.fn((file: File) => Promise.resolve(file)),
  encodeUploadImageVariants: vi.fn(() => Promise.resolve({ full: "data:,", thumb: "data:," })),
}));

vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn(() => Promise.resolve()) }),
}));

vi.mock("@/components/admin-section", () => ({
  AdminSection: (props: { children: ReactNode }) => <section>{props.children}</section>,
}));

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

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

const TARGETS = [
  { id: "ep-alice", name: "Alice Ace" },
  { id: "ep-bob", name: "Bob Bison" },
];

const revoked: string[] = [];

/** A staged image whose filename auto-matches Alice on the given side. */
const png = (side: "front" | "back") =>
  new File(["x"], `alice-ace-${side}.png`, { type: "image/png" });

/** Stage `files` through the panel's hidden file input and wait for the rows. */
async function stage(files: File[]) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files } });
  await waitFor(() => expect(screen.getByRole("button", { name: /^Upload \d/ })).toBeEnabled());
}

beforeEach(() => {
  revoked.length = 0;
  bulkUpload.mockReset();
  // Named after the file so an assertion can say which preview was released.
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn((f: File) => `blob:${f.name}`),
    revokeObjectURL: vi.fn((url: string) => revoked.push(url)),
  });
});

describe("previews of files that leave the staging list", () => {
  it("releases the ones that uploaded when only some of the batch failed", async () => {
    // The panel keeps the failures on screen so they can be retried and drops
    // the rest — and dropping them was the one removal path out of four that
    // did not revoke first, so every successful card in a mixed batch leaked a
    // blob url and the byte copy behind it for the life of the document.
    bulkUpload.mockResolvedValue({
      results: [
        { ok: true, eventParticipantId: "ep-alice", side: "front" },
        { ok: false, eventParticipantId: "ep-alice", side: "back", error: "storage said no" },
      ],
    });

    render(<CardBulkUpload eventId="event-1" targets={TARGETS} />);
    await stage([png("front"), png("back")]);
    await userEvent.click(screen.getByRole("button", { name: /^Upload 2/ }));

    await waitFor(() => expect(revoked).toContain("blob:alice-ace-front.png"));
    // The retryable one is still on screen, so its preview must still resolve.
    expect(revoked).not.toContain("blob:alice-ace-back.png");
    expect(screen.getByText("alice-ace-back.png")).toBeInTheDocument();
    expect(screen.queryByText("alice-ace-front.png")).not.toBeInTheDocument();
  });

  it("releases everything still staged when the panel goes away", async () => {
    // Blob urls are scoped to the document, not the component, and this app
    // routes on the client — so leaving /admin mid-batch used to pin every
    // staged file until the tab was reloaded.
    const { unmount } = render(<CardBulkUpload eventId="event-1" targets={TARGETS} />);
    await stage([png("front"), png("back")]);
    expect(revoked).toEqual([]);

    unmount();
    expect(revoked.sort()).toEqual(["blob:alice-ace-back.png", "blob:alice-ace-front.png"]);
  });
});
