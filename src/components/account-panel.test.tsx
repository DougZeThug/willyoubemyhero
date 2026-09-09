// The account, moved out of the header dropdown.
//
// What is worth pinning is not the markup but the sign-out sequence, whose ORDER
// is load-bearing, and the fact that this block renders something useful while
// signed out — which the menu it replaced could not do at all.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccountPanel } from "./account-panel";

const navigate = vi.fn();
const cancelQueries = vi.fn(() => Promise.resolve());
const clear = vi.fn();
const signOutAccount = vi.fn(() => Promise.resolve());
const useAuthUser = vi.fn();
/** The order the three sign-out steps actually ran in. */
let order: string[] = [];

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...rest }: { children: React.ReactNode; to: string }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  useNavigate: () => navigate,
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    cancelQueries: () => {
      order.push("cancel");
      return cancelQueries();
    },
    clear: () => {
      order.push("clear");
      clear();
    },
  }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/hooks/use-account", () => ({
  useAuthUser: () => useAuthUser(),
  signOutAccount: () => {
    order.push("signOut");
    return signOutAccount();
  },
}));

beforeEach(() => {
  order = [];
  useAuthUser.mockReturnValue({ user: null, loading: false });
});

describe("AccountPanel", () => {
  it("offers a way in while signed out, which the header menu never did", () => {
    render(<AccountPanel />);
    expect(screen.getByRole("link", { name: /sign in/i })).toHaveAttribute("href", "/auth");
  });

  it("does not claim you are signed out while the session is still answering", () => {
    // A line that flips a tick later reads as having been logged out just now.
    useAuthUser.mockReturnValue({ user: null, loading: true });
    render(<AccountPanel />);
    expect(screen.getByText(/checking your account/i)).toBeInTheDocument();
  });

  it("names the account it is signed in to", () => {
    useAuthUser.mockReturnValue({ user: { email: "bob@example.com" }, loading: false });
    render(<AccountPanel />);
    expect(screen.getByText("bob@example.com")).toBeInTheDocument();
  });

  it("cancels and clears the cache before the session goes", async () => {
    // In-flight queries land as errors if the session goes first, and a cache
    // left behind lets Back restore a shell hydrated from the account that just
    // left. Both were bugs the header's version had already been fixed for.
    useAuthUser.mockReturnValue({ user: { email: "bob@example.com" }, loading: false });
    render(<AccountPanel />);
    await userEvent.click(screen.getByRole("button", { name: /sign out/i }));
    expect(order).toEqual(["cancel", "clear", "signOut"]);
    expect(navigate).toHaveBeenCalledWith({ to: "/auth", replace: true });
  });
});
