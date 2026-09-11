// Where a sign-in lands you, on the two paths that leave this origin and return.
//
// `?next=` works by itself for the in-page sign-in, because the page never
// unmounts and the search param is still there when the password resolves. It
// cannot work by itself for Google or for an email confirmation link: both come
// back as a fresh load of /auth with a bare URL, so the destination has to be
// held on the device across the round trip. "Sign in to claim" spent its whole
// life landing people on the vault instead of on the rung it named.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import AuthPage from "./auth";
import { setAccountSyncState } from "@/lib/account-sync-state";
import { stashAuthNext, takeAuthNext } from "@/lib/auth-next";

const search = vi.fn();
const navigate = vi.fn();
const useAuthUser = vi.fn();
const signInWithOAuth = vi.fn();
const signUp = vi.fn();
const signInWithPassword = vi.fn();

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    Link: (props: { to: string; children: ReactNode }) => <a href={props.to}>{props.children}</a>,
    useNavigate: () => navigate,
    // The page reads `Route.useSearch()`, which needs a router around it. The
    // validation itself is pinned in auth-next.test.ts; what matters here is
    // what the component does with the answer.
    createFileRoute: () => (opts: Record<string, unknown>) => ({
      ...opts,
      useSearch: () => search(),
    }),
  };
});

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      signUp: (...a: unknown[]) => signUp(...a),
      signInWithPassword: (...a: unknown[]) => signInWithPassword(...a),
    },
  },
}));

vi.mock("@/integrations/lovable", () => ({
  lovable: { auth: { signInWithOAuth: (...a: unknown[]) => signInWithOAuth(...a) } },
}));

vi.mock("@/hooks/use-account", () => ({
  useAuthUser: () => useAuthUser(),
  signOutAccount: vi.fn(async () => {}),
}));

vi.mock("@/lib/member-token", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useMemberSession: () => null };
});

const USER = { id: "user-1", email: "doug@example.com" };

beforeEach(() => {
  window.localStorage.clear();
  search.mockReset().mockReturnValue({});
  navigate.mockReset();
  useAuthUser.mockReset().mockReturnValue({ user: null, loading: false });
  signInWithOAuth.mockReset().mockResolvedValue({ redirected: true });
  signUp.mockReset().mockResolvedValue({ data: { session: null }, error: null });
  signInWithPassword.mockReset().mockResolvedValue({ error: null });
  setAccountSyncState({ status: "idle", userId: null, message: null });
});

describe("leaving for an auth round trip", () => {
  it("holds the destination on the device before handing off to Google", async () => {
    // The return URL has to stay bare `/auth` — it is matched against a redirect
    // allow-list rather than composed per destination — so the query string is
    // not where this can live.
    search.mockReturnValue({ mode: "signup", next: "/players/pack" });
    render(<AuthPage />);
    await userEvent.click(screen.getByRole("button", { name: /continue with google/i }));

    await waitFor(() => expect(signInWithOAuth).toHaveBeenCalled());
    expect(signInWithOAuth.mock.calls[0][1]).toEqual({
      redirect_uri: `${window.location.origin}/auth`,
    });
    expect(takeAuthNext()).toBe("/players/pack");
  });

  it("holds it before an email confirmation goes out too", async () => {
    // Confirmation on means signUp returns no session at all: the next thing to
    // load this page is the link in the email, hours later and with a bare URL.
    search.mockReturnValue({ mode: "signup", next: "/players/pack" });
    render(<AuthPage />);
    await userEvent.type(screen.getByLabelText(/email/i), "doug@example.com");
    await userEvent.type(screen.getByLabelText(/password/i), "hunter22");
    await userEvent.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => expect(signUp).toHaveBeenCalled());
    expect(takeAuthNext()).toBe("/players/pack");
  });

  it("holds nothing when nobody asked to be sent on", async () => {
    render(<AuthPage />);
    await userEvent.click(screen.getByRole("button", { name: /continue with google/i }));
    await waitFor(() => expect(signInWithOAuth).toHaveBeenCalled());
    expect(takeAuthNext()).toBeUndefined();
  });
});

describe("coming back from one", () => {
  it("sends you where the CTA promised, with nothing left on the URL", async () => {
    // The bug, exactly: signed in, linked, and on a bare /auth. Before this the
    // redirect could not fire at all — no `next`, and `wasSignedOut` never arms
    // because the session is already attached by the first settled render — so
    // the only way out was "Go to the vault".
    stashAuthNext("/players/pack");
    useAuthUser.mockReturnValue({ user: USER, loading: false });
    setAccountSyncState({ status: "ready", userId: USER.id, message: null });

    render(<AuthPage />);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: "/players/pack" }));
  });

  it("waits for the collection to be linked before moving anybody", async () => {
    // Navigating mid-link drops the phone on the vault while its cards are still
    // being filed, which is the empty-vault flash this screen exists to prevent.
    stashAuthNext("/players/pack");
    useAuthUser.mockReturnValue({ user: USER, loading: false });
    setAccountSyncState({ status: "syncing", userId: USER.id, message: null });

    render(<AuthPage />);
    await screen.findByText(/securing your cards/i);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("does not move a signed-in person who simply opened their account screen", async () => {
    // The steady state, and the whole reason the redirect is armed rather than
    // unconditional: this screen holds the email address, the sign-out and the
    // only in-app route to /claim for a signed-in player.
    useAuthUser.mockReturnValue({ user: USER, loading: false });
    setAccountSyncState({ status: "ready", userId: USER.id, message: null });

    render(<AuthPage />);
    await screen.findByText(USER.email);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("prefers the URL and leaves the stash for whoever is mid-flight", async () => {
    // Two tabs: one waiting on Google, one opened fresh from a CTA. The live URL
    // is this tab's business, and taking the stash here would strand the other.
    stashAuthNext("/players/trade");
    search.mockReturnValue({ next: "/players/pack" });
    useAuthUser.mockReturnValue({ user: USER, loading: false });
    setAccountSyncState({ status: "ready", userId: USER.id, message: null });

    render(<AuthPage />);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: "/players/pack" }));
    expect(takeAuthNext()).toBe("/players/trade");
  });

  it("falls back to the vault when the stash has nothing in it", async () => {
    search.mockReturnValue({});
    useAuthUser.mockReturnValueOnce({ user: null, loading: false });
    const { rerender } = render(<AuthPage />);
    useAuthUser.mockReturnValue({ user: USER, loading: false });
    setAccountSyncState({ status: "ready", userId: USER.id, message: null });
    rerender(<AuthPage />);

    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: "/players" }));
  });
});

describe("the reason printed on the page", () => {
  it("still explains itself after a round trip lost the URL", async () => {
    // Somebody who confirmed an email and landed back here signed OUT needs the
    // same line they were shown on the way in, or the screen is a bare sign-in
    // form with no connection to the button they pressed.
    stashAuthNext("/players/pack");
    render(<AuthPage />);
    expect(await screen.findByText(/your streak reward is waiting/i)).toBeInTheDocument();
  });
});
