// The name box for somebody who signed in but is not on the roster. It is the
// only player-facing field no browser test can reach: the gate needs a real
// Supabase user, and the account sync that fires the moment one appears has no
// e2e stub, so reaching it would mean faking a session to make one assertion.
//
// So the floor is pinned here by class rather than by pixel — jsdom has no
// Tailwind and cannot measure either. That the four classes actually render
// 44px and 16px on a coarse pointer is proved once, in a real browser, on
// card-social's comment box, which carries the identical set (§23 F1, F2).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { User } from "@supabase/supabase-js";
import { createQueryWrapper } from "@/test/query";
import { getMemberToken, setMemberToken } from "@/lib/member-token";
import { snapshotLocalCollection } from "@/lib/adopt-collection";

const createCollectorIdentity = vi.fn();
const toastError = vi.fn();
const toastSuccess = vi.fn();
const authUser = vi.fn();

vi.mock("@/lib/collector.functions", () => ({
  createCollectorIdentity: (...a: unknown[]) => createCollectorIdentity(...a),
}));

vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useServerFn: (fn: unknown) => fn };
});

vi.mock("@/hooks/use-account", () => ({ useAuthUser: () => authUser() }));

const adoptLocalCollection = vi.fn();
const holdForAdoption = vi.fn();
const releaseAdoptionHold = vi.fn();

vi.mock("@/lib/adopt-collection", () => ({
  snapshotLocalCollection: vi.fn().mockResolvedValue({ "ep-1": { eventParticipantId: "ep-1" } }),
  adoptLocalCollection: (...a: unknown[]) => adoptLocalCollection(...a),
  holdForAdoption: (...a: unknown[]) => holdForAdoption(...a),
  releaseAdoptionHold: (...a: unknown[]) => releaseAdoptionHold(...a),
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...a: unknown[]) => toastError(...a),
    success: (...a: unknown[]) => toastSuccess(...a),
  },
}));

const PID = "00000000-0000-4000-8000-0000000000aa";

/** Only the two fields the component reads; the rest of `User` is not its business. */
function user(email: string | null = "jane.doe@example.com"): User {
  return { id: "auth-1", email } as User;
}

async function renderSignup() {
  const { CollectorSignup } = await import("./collector-signup");
  const { wrapper } = createQueryWrapper();
  return render(<CollectorSignup />, { wrapper });
}

async function renderGate() {
  const { CollectorSignupGate } = await import("./collector-signup");
  const { wrapper } = createQueryWrapper();
  return render(<CollectorSignupGate />, { wrapper });
}

/** A signed token this device would actually keep — `getMemberToken` parses it. */
const TOKEN = `m.${PID}.${Date.now() + 90 * 86_400_000}.signature`;

beforeEach(() => {
  window.localStorage.clear();
  createCollectorIdentity
    .mockReset()
    .mockResolvedValue({ token: TOKEN, name: "Jane Doe", participantId: PID });
  vi.mocked(snapshotLocalCollection).mockResolvedValue({
    "ep-1": { eventParticipantId: "ep-1" },
  } as never);
  adoptLocalCollection.mockReset().mockResolvedValue(undefined);
  holdForAdoption.mockReset().mockImplementation(() => Promise.resolve());
  releaseAdoptionHold.mockReset().mockImplementation(() => Promise.resolve());
  toastError.mockReset();
  toastSuccess.mockReset();
  authUser.mockReset().mockReturnValue({ user: user(), loading: false });
});

describe("the touch floor", () => {
  // jsdom has no layout, so the 44px itself is an e2e measurement. The classes
  // are what can be pinned here: 16px until the pointer is a mouse, released on
  // `pointer-fine:` rather than a width, because a landscape phone is past `md:`
  // with the thumb still the input.
  it("keeps the name box at 16px until the pointer is a mouse", async () => {
    await renderSignup();
    expect(screen.getByPlaceholderText("Your name")).toHaveClass(
      "min-h-11",
      "text-base",
      "pointer-fine:min-h-0",
      "pointer-fine:text-sm",
    );
  });
});

describe("the gate", () => {
  it("stays shut while the session is still loading", async () => {
    authUser.mockReturnValue({ user: null, loading: true });
    await renderGate();
    expect(screen.queryByPlaceholderText("Your name")).not.toBeInTheDocument();
  });

  it("stays shut for a signed-out guest, who gets the claim flow instead", async () => {
    authUser.mockReturnValue({ user: null, loading: false });
    await renderGate();
    expect(screen.queryByPlaceholderText("Your name")).not.toBeInTheDocument();
  });

  it("stays shut once they have a player, who is already reachable", async () => {
    setMemberToken(`m.${PID}.${Date.now() + 60_000}.signature`, "Doug");
    await renderGate();
    expect(screen.queryByPlaceholderText("Your name")).not.toBeInTheDocument();
  });

  it("opens for the case it exists for: signed in, no player", async () => {
    await renderGate();
    expect(await screen.findByPlaceholderText("Your name")).toBeInTheDocument();
  });
});

describe("naming yourself", () => {
  it("suggests a name from the email local part", async () => {
    await renderSignup();
    expect(screen.getByPlaceholderText("Your name")).toHaveValue("Jane Doe");
  });

  it("refuses a name too short to identify anyone", async () => {
    authUser.mockReturnValue({ user: user("a@example.com"), loading: false });
    await renderSignup();
    expect(screen.getByRole("button", { name: /start trading/i })).toBeDisabled();
  });

  it("sends the trimmed name and says who you are now", async () => {
    await renderSignup();
    const box = screen.getByPlaceholderText("Your name");
    await userEvent.clear(box);
    await userEvent.type(box, "  Bob Blitz  ");
    await userEvent.click(screen.getByRole("button", { name: /start trading/i }));

    await waitFor(() =>
      expect(createCollectorIdentity).toHaveBeenCalledWith({ data: { displayName: "Bob Blitz" } }),
    );
    expect(toastSuccess).toHaveBeenCalledWith("You're in, Jane Doe");
  });

  it("reports a failed set-up rather than clearing the box", async () => {
    createCollectorIdentity.mockRejectedValue(new Error("Name already taken"));
    await renderSignup();
    await userEvent.click(screen.getByRole("button", { name: /start trading/i }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Name already taken"));
    expect(screen.getByPlaceholderText("Your name")).toHaveValue("Jane Doe");
  });
});

// `createCollector` reparents the guest's pack_opens but mints no card_copies:
// adoption is the only thing that files the cards themselves. So a token left on
// over a failed upload points the collection hook at a server record that has
// never heard of them, and an empty answer reads as "you own nothing" rather
// than "we don't know" — which is a delete. The other two doors onto the roster,
// /claim and the account sync, both take the token back off. This one did not.
describe("when the cards can't be uploaded", () => {
  it("retries once, because the first request off a woken phone is the flaky one", async () => {
    adoptLocalCollection.mockRejectedValueOnce(new Error("network")).mockResolvedValue(undefined);
    await renderSignup();
    await userEvent.click(screen.getByRole("button", { name: /start trading/i }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("You're in, Jane Doe"));
    expect(adoptLocalCollection).toHaveBeenCalledTimes(2);
    expect(getMemberToken()).toBe(TOKEN);
  });

  it("takes the token back off when the retry fails too, so nothing is pruned", async () => {
    adoptLocalCollection.mockRejectedValue(new Error("network"));
    await renderSignup();
    await userEvent.click(screen.getByRole("button", { name: /start trading/i }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/couldn't be transferred/i))); // prettier-ignore
    expect(getMemberToken()).toBeNull();
    // Not "You're in" over a handoff that did not happen.
    expect(toastSuccess).not.toHaveBeenCalled();
    // Nobody is reconciling any more, so nothing is owed a hold: released with no
    // query client, because there is no refetch to wait for.
    expect(releaseAdoptionHold).toHaveBeenCalledTimes(1);
    expect(releaseAdoptionHold.mock.calls[0]).toHaveLength(2);
  });

  it("never publishes the token when the hold could not be written", async () => {
    holdForAdoption.mockRejectedValue(new Error("Could not protect your cards on this device"));
    await renderSignup();
    await userEvent.click(screen.getByRole("button", { name: /start trading/i }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/protect your cards/i))); // prettier-ignore
    expect(getMemberToken()).toBeNull();
    expect(adoptLocalCollection).not.toHaveBeenCalled();
  });

  it("reads the collection after the set-up round trip, so a card turned meanwhile is filed", async () => {
    // See the claim page: the snapshot drives both the hold and the filing, and a
    // pack screen in another tab keeps flipping cards while the request is out.
    const turned = { "ep-1": { eventParticipantId: "ep-1" }, "ep-9": { eventParticipantId: "ep-9" } }; // prettier-ignore
    createCollectorIdentity.mockImplementation(async () => {
      vi.mocked(snapshotLocalCollection).mockResolvedValue(turned as never);
      return { token: TOKEN, name: "Jane Doe", participantId: PID };
    });
    await renderSignup();
    await userEvent.click(screen.getByRole("button", { name: /start trading/i }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("You're in, Jane Doe"));
    expect(holdForAdoption).toHaveBeenCalledWith(PID, turned);
    expect(adoptLocalCollection).toHaveBeenCalledWith(turned);
  });

  it("holds the cards before the token lands and lets go once they are filed", async () => {
    // A vault in another tab reconciles on hearing the token; the hold is what
    // stops it reading an adoption still in the air as "you own nothing".
    // Asserted as what was on the device WHEN the hold ran, not as call order: a
    // fire-and-forget hold would still be "called first" while the token raced it.
    const tokenWhenHeld: (string | null)[] = [];
    holdForAdoption.mockImplementation(() => {
      tokenWhenHeld.push(getMemberToken());
      return Promise.resolve();
    });
    await renderSignup();
    await userEvent.click(screen.getByRole("button", { name: /start trading/i }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("You're in, Jane Doe"));
    const snapshot = { "ep-1": { eventParticipantId: "ep-1" } };
    expect(holdForAdoption).toHaveBeenCalledWith(PID, snapshot);
    expect(tokenWhenHeld).toEqual([null]);
    expect(releaseAdoptionHold).toHaveBeenCalledWith(PID, snapshot, expect.anything());
  });
});
