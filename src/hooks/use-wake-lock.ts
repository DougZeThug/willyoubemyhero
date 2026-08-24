// Keep the screen awake while something on this phone must not be interrupted.
//
// The timing console is the reason this exists: the commissioner's phone going
// dark mid-run doesn't lose the time — the active run is anchored on epoch ms
// and stored in IndexedDB — but it does mean fumbling a lock screen to hit
// Finish while an athlete sprints at the line. The Wake Lock API is the fix
// where it exists; where it doesn't, this quietly does nothing and the
// epoch-anchored recovery stays the fallback.
import { useEffect } from "react";

export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let released = false;
    let acquiring = false;
    let sentinel: WakeLockSentinel | null = null;

    const acquire = async () => {
      // One request in flight at a time, and none while a live lock is held:
      // two resolved requests are two independent sentinels, and an overwrite
      // here would strand the first one holding the screen awake forever.
      if (acquiring || (sentinel && !sentinel.released)) return;
      acquiring = true;
      try {
        const s = await navigator.wakeLock.request("screen");
        if (released) {
          // The effect tore down while the request was in flight — a lock
          // acquired now would never be released by the cleanup below.
          void s.release().catch(() => {});
          return;
        }
        sentinel = s;
      } catch {
        // Low battery, a permissions policy, or a hidden tab. The lock is a
        // nicety; every one of these already has the IndexedDB fallback.
      } finally {
        acquiring = false;
      }
    };

    // The browser drops the lock whenever the tab hides. Take it back the
    // moment the tab returns — which is exactly when timing resumes.
    const onVisible = () => {
      if (document.visibilityState === "visible") void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      released = true;
      document.removeEventListener("visibilitychange", onVisible);
      void sentinel?.release().catch(() => {});
    };
  }, [active]);
}
