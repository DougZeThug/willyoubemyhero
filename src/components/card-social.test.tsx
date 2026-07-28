// Reactions and trash talk. Everything here is gated on being a claimed member,
// and the reaction count is optimistic — both are easy to get subtly wrong.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createQueryWrapper } from "@/test/query";
import { setMemberToken } from "@/lib/member-token";
import type { CommentRow, ReactionRow } from "@/hooks/use-event-social";

const toggleReaction = vi.fn();
const postComment = vi.fn();
const deleteComment = vi.fn();
const toastError = vi.fn();

vi.mock("@/lib/social.functions", () => ({
  toggleReaction: (...a: unknown[]) => toggleReaction(...a),
  postComment: (...a: unknown[]) => postComment(...a),
  deleteComment: (...a: unknown[]) => deleteComment(...a),
}));

vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a) } }));

const EVENT_ID = "event-1";
const CARD_ID = "ep-1";
const ME = "00000000-0000-4000-8000-0000000000aa";
const THEM = "00000000-0000-4000-8000-0000000000bb";

const NAMES: Record<string, string> = { [ME]: "Doug", [THEM]: "Alice" };
const nameOf = (id: string) => NAMES[id] ?? "Someone";

function reaction(over: Partial<ReactionRow> = {}): ReactionRow {
  return {
    id: "r1",
    event_participant_id: CARD_ID,
    participant_id: THEM,
    emoji: "🔥",
    created_at: "2026-07-28T12:00:00Z",
    ...over,
  };
}

function comment(over: Partial<CommentRow> = {}): CommentRow {
  return {
    id: "c1",
    event_participant_id: CARD_ID,
    participant_id: THEM,
    body: "All mouth, results pending.",
    created_at: "2026-07-28T12:00:00Z",
    ...over,
  };
}

function signIn() {
  setMemberToken(`m.${ME}.${Date.now() + 60_000}.signature`, "Doug");
}

async function renderSocial(
  props: Partial<{ reactions: ReactionRow[]; comments: CommentRow[] }> = {},
) {
  const { CardSocial } = await import("./card-social");
  const { wrapper } = createQueryWrapper();
  return render(
    <CardSocial
      eventId={EVENT_ID}
      eventParticipantId={CARD_ID}
      reactions={props.reactions ?? []}
      comments={props.comments ?? []}
      nameOf={nameOf}
    />,
    { wrapper },
  );
}

beforeEach(() => {
  window.localStorage.clear();
  toggleReaction.mockReset().mockResolvedValue({ ok: true, reacted: true });
  postComment.mockReset().mockResolvedValue({ ok: true });
  deleteComment.mockReset().mockResolvedValue({ ok: true });
  toastError.mockReset();
});

describe("when signed out", () => {
  it("disables every reaction button", async () => {
    await renderSocial();
    for (const button of screen.getAllByRole("button", { name: /claim your player to react/i })) {
      expect(button).toBeDisabled();
    }
  });

  it("prompts for a claim instead of showing the comment box", async () => {
    await renderSocial();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /claim your player/i }).length).toBeGreaterThan(0);
  });

  it("still shows everyone else's reactions and trash talk", async () => {
    await renderSocial({ reactions: [reaction()], comments: [comment()] });
    expect(screen.getByText("All mouth, results pending.")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });
});

describe("reactions", () => {
  beforeEach(signIn);

  it("offers the six league reactions", async () => {
    await renderSocial();
    for (const emoji of ["🔥", "💀", "😂", "🐐", "🤡", "🍺"]) {
      expect(screen.getByRole("button", { name: `React with ${emoji}` })).toBeInTheDocument();
    }
  });

  it("counts existing reactions per emoji", async () => {
    await renderSocial({
      reactions: [
        reaction({ id: "r1", emoji: "🔥" }),
        reaction({ id: "r2", emoji: "🔥", participant_id: ME }),
        reaction({ id: "r3", emoji: "💀" }),
      ],
    });
    const fire = screen.getByRole("button", { name: "React with 🔥" });
    expect(fire).toHaveTextContent("2");
  });

  it("sends the emoji and card to the server on tap", async () => {
    await renderSocial();
    await userEvent.click(screen.getByRole("button", { name: "React with 🔥" }));
    await waitFor(() =>
      expect(toggleReaction).toHaveBeenCalledWith({
        data: { eventParticipantId: CARD_ID, emoji: "🔥" },
      }),
    );
  });

  it("bumps the count immediately, before the refetch lands", async () => {
    // Without the optimistic delta the count sat still for a beat after every
    // tap and the button read as broken.
    let release!: () => void;
    toggleReaction.mockImplementation(
      () => new Promise((resolve) => (release = () => resolve({ ok: true }))),
    );
    await renderSocial();
    const fire = screen.getByRole("button", { name: "React with 🔥" });
    expect(fire).toHaveTextContent("0");

    await userEvent.click(fire);
    expect(fire).toHaveTextContent("1");
    release();
  });

  it("counts down when removing a reaction it already owns", async () => {
    let release!: () => void;
    toggleReaction.mockImplementation(
      () => new Promise((resolve) => (release = () => resolve({ ok: true }))),
    );
    await renderSocial({ reactions: [reaction({ participant_id: ME })] });
    const fire = screen.getByRole("button", { name: "React with 🔥" });
    expect(fire).toHaveTextContent("1");

    await userEvent.click(fire);
    expect(fire).toHaveTextContent("0");
    release();
  });

  it("never shows a negative count", async () => {
    let release!: () => void;
    toggleReaction.mockImplementation(
      () => new Promise((resolve) => (release = () => resolve({ ok: true }))),
    );
    // Marked as mine but absent from the list — a stale render mid-refetch.
    await renderSocial({ reactions: [reaction({ participant_id: ME, emoji: "💀" })] });
    const skull = screen.getByRole("button", { name: "React with 💀" });
    await userEvent.click(skull);
    expect(skull).toHaveTextContent("0");
    expect(skull).not.toHaveTextContent("-1");
    release();
  });

  it("reports a failed toggle and rolls the count back", async () => {
    toggleReaction.mockRejectedValue(new Error("Claim your player first"));
    await renderSocial();
    const fire = screen.getByRole("button", { name: "React with 🔥" });
    await userEvent.click(fire);
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Claim your player first"));
    expect(fire).toHaveTextContent("0");
  });

  it("names who reacted, for touch devices that never see a title tooltip", async () => {
    await renderSocial({ reactions: [reaction()] });
    await userEvent.click(screen.getByRole("button", { name: "Who reacted with 🔥" }));
    expect(await screen.findByText("Alice")).toBeInTheDocument();
  });
});

describe("trash talk", () => {
  beforeEach(signIn);

  it("invites the first comment when there are none", async () => {
    await renderSocial();
    expect(screen.getByText(/Nothing yet/)).toBeInTheDocument();
  });

  it("lists comments with their author", async () => {
    await renderSocial({ comments: [comment()] });
    expect(screen.getByText("All mouth, results pending.")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("keeps the submit button disabled until there is something to say", async () => {
    await renderSocial();
    const submit = screen.getByRole("button", { name: "Post" });
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByRole("textbox"), "get wrecked");
    expect(submit).toBeEnabled();
  });

  it("stays disabled for whitespace only", async () => {
    await renderSocial();
    await userEvent.type(screen.getByRole("textbox"), "   ");
    expect(screen.getByRole("button", { name: "Post" })).toBeDisabled();
  });

  it("posts a trimmed body and clears the box", async () => {
    await renderSocial();
    const input = screen.getByRole("textbox");
    await userEvent.type(input, "  get wrecked  ");
    await userEvent.click(screen.getByRole("button", { name: "Post" }));
    await waitFor(() =>
      expect(postComment).toHaveBeenCalledWith({
        data: { eventParticipantId: CARD_ID, body: "get wrecked" },
      }),
    );
    await waitFor(() => expect(input).toHaveValue(""));
  });

  it("caps input at the 280 characters the server accepts", async () => {
    await renderSocial();
    const input = screen.getByRole("textbox") as HTMLInputElement;
    await userEvent.type(input, "x".repeat(300));
    expect(input.value).toHaveLength(280);
  });

  it("reports a failed post and keeps the draft", async () => {
    postComment.mockRejectedValue(new Error("Could not post"));
    await renderSocial();
    await userEvent.type(screen.getByRole("textbox"), "get wrecked");
    await userEvent.click(screen.getByRole("button", { name: "Post" }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(screen.getByRole("textbox")).toHaveValue("get wrecked");
  });

  it("offers a delete button on your own comment only", async () => {
    await renderSocial({
      comments: [comment({ id: "mine", participant_id: ME }), comment({ id: "theirs" })],
    });
    expect(screen.getAllByRole("button", { name: "Delete your comment" })).toHaveLength(1);
  });

  it("deletes by comment id", async () => {
    await renderSocial({ comments: [comment({ id: "mine", participant_id: ME })] });
    await userEvent.click(screen.getByRole("button", { name: "Delete your comment" }));
    await waitFor(() =>
      expect(deleteComment).toHaveBeenCalledWith({ data: { commentId: "mine" } }),
    );
  });
});
