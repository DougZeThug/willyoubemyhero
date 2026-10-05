import { useAdminSession, type AdminSession } from "@/lib/admin-token";
import { useAuthUser } from "@/hooks/use-account";

/**
 * A token another account earned on this handset is not this account's console.
 *
 * A signed-out device is not "held by another": the token outlives a sign-out
 * on purpose (ADM-16), and the commissioner who typed the PIN keeps their
 * console until somebody else signs in and `bindAdminTokenTo` takes it off.
 */
export function isHeldByAnotherAccount(
  admin: Pick<AdminSession, "owner"> | null,
  userId: string | null | undefined,
): boolean {
  return !!userId && !!admin?.owner && admin.owner !== userId;
}

/**
 * Whether this device holds the admin console for `eventId`, for the account
 * using it.
 *
 * Every screen that paints commissioner controls asks this rather than comparing
 * the token's event id itself. The token names no user, and `requireAdmin` checks
 * the event and nothing else, so the stored owner is the only thing standing
 * between the next account on a shared handset and the console. /admin checked
 * it and /live, /draft and /order did not, which made a token the wrong account
 * had planted invisible on the one screen that looked.
 */
export function useEventAdmin(eventId: string | null | undefined): boolean {
  const admin = useAdminSession();
  const { user, loading } = useAuthUser();
  // Not while the session is still being read. `useAuthUser` starts at "nobody", and a
  // null user is not "held by another", so a cold load would paint the previous
  // account's console for the renders before getSession() says who is really here.
  if (loading) return false;
  return !!eventId && admin?.eventId === eventId && !isHeldByAnotherAccount(admin, user?.id);
}
