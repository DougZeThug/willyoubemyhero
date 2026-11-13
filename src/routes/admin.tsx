import { createFileRoute } from "@tanstack/react-router";
import { useAdminSession } from "@/lib/admin-token";
import { useAuthUser } from "@/hooks/use-account";
import { isHeldByAnotherAccount } from "@/hooks/use-event-admin";
import { useAdminAutoUnlock } from "@/hooks/use-admin-auto-unlock";
import { useEventBundle } from "@/hooks/use-event-bundle";
import { PinGate } from "@/components/admin/pin-gate";
import { TimingConsole } from "@/components/admin/timing-console";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin — Will YOU Be My Hero? Draft Combine" },
      { name: "description", content: "Timing console and event controls for combine admins." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminPage,
});

function AdminPage() {
  const { event } = useEventBundle();
  const admin = useAdminSession();
  // Accounts on the admin list skip the PIN entirely; the PIN stays as the
  // fallback for anyone signed out or not on the list.
  const { user, loading: authLoading } = useAuthUser();
  // A token another account earned on this handset is not this account's
  // console. useAccountSync takes it off, but from the root and in its own
  // effect — without this the console paints for a commit first, and the
  // account check below is skipped for the person actually signed in.
  const heldByAnother = isHeldByAnotherAccount(admin, user?.id);
  // `!!` rather than Boolean() on purpose: it narrows `event` for the right
  // half of the &&, which Boolean() does not, and without it `event.id` there
  // is a type error.
  // Not while the session is still being read: a null user is not "held by another",
  // so the stored token would paint its console for the renders before getSession()
  // says who is here. The gate below holds the PIN form back for the same stretch.
  const isAdmin = !!event?.id && admin?.eventId === event.id && !heldByAnother && !authLoading;
  const accountChecked = useAdminAutoUnlock(isAdmin, user, authLoading);

  if (!event || !event.id) {
    return <div className="mx-auto max-w-md p-6 text-sm text-muted-foreground">Loading…</div>;
  }

  if (!isAdmin && (authLoading || !accountChecked)) {
    return (
      <div className="mx-auto max-w-md p-6 text-sm text-muted-foreground">Checking access…</div>
    );
  }

  return isAdmin ? (
    <TimingConsole />
  ) : (
    <PinGate eventId={event.id} eventName={event.name ?? "Combine"} userId={user?.id ?? null} />
  );
}
