import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { signOutAccount, useAuthUser } from "@/hooks/use-account";

/**
 * The account, as a block on a page rather than a menu in the header.
 *
 * This is the dropdown that used to hang off the header's person icon, moved
 * whole. It moved because a menu is the wrong shape for it: three of its four
 * items were links to screens, the fourth was the only place in the app to sign
 * out, and none of it was reachable while signed out — so "where do I change
 * this" had two answers depending on a state the person could not see. The icon
 * now goes to /you and this is what it finds.
 *
 * The sign-out sequence is the header's, unchanged, and the order in it is
 * load-bearing: in-flight queries are cancelled before the session goes so they
 * do not land as errors, and the cache is cleared so Back cannot restore a shell
 * hydrated from the account that just left.
 */
export function AccountPanel() {
  const { user, loading } = useAuthUser();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await signOutAccount();
    toast.success("Signed out");
    void navigate({ to: "/auth", replace: true });
  }

  if (!user) {
    return (
      <div className="surface-panel rounded-xl border border-primary/20 p-4">
        <p className="text-sm text-muted-foreground">
          {/* Deliberately not "you are signed out": until the session answers,
              nobody is, and a line that flips a tick later reads as having been
              logged out just now. */}
          {loading
            ? "Checking your account…"
            : "An account keeps your cards on your name rather than on this phone, and it is what lets you claim a streak reward."}
        </p>
        <Link to="/auth" className="neon-btn-sm mt-3 inline-flex">
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="surface-panel rounded-xl border border-primary/20 p-4">
      <p className="truncate text-sm text-muted-foreground">{user.email ?? "Signed in"}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link to="/auth" className="neon-btn-sm">
          Account
        </Link>
        <button type="button" className="neon-btn-quiet" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    </div>
  );
}
