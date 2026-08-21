import { getGuestToken } from "./guest-token";
import { getMemberToken } from "./member-token";

const KEY = "wwbh:account-handoff-token";

/** Preserve the identity held before an auth redirect or session transition. */
export function preserveAccountHandoff() {
  if (typeof window === "undefined") return;
  const token = getMemberToken() ?? getGuestToken();
  if (token) window.localStorage.setItem(KEY, token);
}

export function getAccountHandoffToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(KEY);
}

export function clearAccountHandoff() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY);
}