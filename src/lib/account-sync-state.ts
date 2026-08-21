import { useEffect, useState } from "react";

export type AccountSyncState =
  | { status: "idle" | "syncing"; userId: string | null; message: null }
  | { status: "ready"; userId: string; message: null }
  | { status: "error"; userId: string; message: string };

let state: AccountSyncState = { status: "idle", userId: null, message: null };
const listeners = new Set<() => void>();

export function setAccountSyncState(next: AccountSyncState) {
  state = next;
  for (const listener of listeners) listener();
}

export function useAccountSyncState() {
  const [snapshot, setSnapshot] = useState<AccountSyncState>(() => state);
  useEffect(() => {
    const listener = () => setSnapshot(state);
    listeners.add(listener);
    listener();
    return () => {
      listeners.add(listener);
      listeners.delete(listener);
    };
  }, []);
  return snapshot;
}
