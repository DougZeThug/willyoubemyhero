import { useCallback, useEffect, useState } from "react";
import { usePackIdentity } from "@/lib/device-id";
import { loadPackState, PACK_DEALT_KEY, PACK_STATE_CHANGED, todayKey } from "@/lib/card-collection";
import { todayPackState, type TodayPack } from "@/lib/pack";

/**
 * Today's pack, read from a screen that is not the pack.
 *
 * The vault has to answer "is it sealed, half open, or spent" without dealing
 * anything, so this only ever READS: `loadPackState` and nothing else. Every
 * write still belongs to players.pack.tsx, which is what keeps one pack a day one
 * pack a day.
 *
 * `"loading"` is a fourth state the design does not name, and it is not optional.
 * The row lives in IndexedDB, which answers a tick after mount and never at all
 * during SSR, so the honest first frame is "I don't know yet". Painting "Open
 * today's pack" over a pack somebody is halfway through — and then swapping the
 * label under their thumb — is the failure `stateLoaded` exists to prevent on the
 * pack screen itself.
 */
export type PackProgress = {
  state: "loading" | "sealed" | "torn" | "done";
  /** Cards still face-down. Zero in every state but `torn`. */
  left: number;
  /** The poll's clock, so the countdown below re-renders with the day tick. */
  now: number;
};

const DAY_TICK_MS = 60_000;

export function usePackProgress(secretPending: boolean): PackProgress {
  const identity = usePackIdentity();
  const [dayKey, setDayKey] = useState(todayKey);
  const [now, setNow] = useState(() => Date.now());
  const [pack, setPack] = useState<TodayPack | null>(null);
  const [nonce, setNonce] = useState(0);

  /**
   * The day rolls over on a poll, not a timer, for the reason players.pack.tsx
   * gives for the same interval: a phone suspends timers when it sleeps, and the
   * one that mattered was always scheduled for exactly the moment the screen was
   * off. The poll doubles as the clock behind "Next pack in 6h" — hours, so once
   * a minute is more than enough — and `visibilitychange` is what makes coming
   * back to the app feel instant rather than up to a minute stale.
   */
  useEffect(() => {
    const check = () => {
      setNow(Date.now());
      setDayKey((prev) => {
        const next = todayKey();
        return prev === next ? prev : next;
      });
    };
    const id = setInterval(check, DAY_TICK_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  const reread = useCallback(() => setNonce((n) => n + 1), []);

  /**
   * Both halves of "the pack changed", because neither covers the other.
   * `PACK_STATE_CHANGED` is this tab's own write, which is what carries a tear
   * back to a vault left open behind the pack screen; `storage` on the mirror key
   * is the OTHER tab, which IndexedDB fires nothing for at all. Same pair
   * players.pack.tsx listens to, and for the same reason.
   */
  useEffect(() => {
    const theirs = (e: StorageEvent) => {
      if (e.key === PACK_DEALT_KEY) reread();
    };
    window.addEventListener(PACK_STATE_CHANGED, reread);
    window.addEventListener("storage", theirs);
    return () => {
      window.removeEventListener(PACK_STATE_CHANGED, reread);
      window.removeEventListener("storage", theirs);
    };
  }, [reread]);

  useEffect(() => {
    // Wait for the browser to say who this pack is for. usePackIdentity is null
    // for one render on every mount while it reads localStorage, and answering
    // then would compare a stored `d:xxx` against nothing and call a pack
    // somebody is mid-reveal on sealed.
    if (identity == null) return;
    let cancelled = false;
    void loadPackState().then((row) => {
      if (cancelled) return;
      setPack(todayPackState({ row, dayKey, identity, secretPending }));
    });
    return () => {
      cancelled = true;
    };
  }, [identity, dayKey, secretPending, nonce]);

  if (!pack) return { state: "loading", left: 0, now };
  return { state: pack.state, left: pack.state === "torn" ? pack.left : 0, now };
}
