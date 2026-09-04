import { useCallback, useEffect, useState } from "react";
import { usePackIdentity } from "@/lib/device-id";
import {
  loadPackState,
  PACK_DEALT_KEY,
  PACK_STATE_CHANGED,
  todayKey,
  type PackState,
} from "@/lib/card-collection";
import { todayPackState } from "@/lib/pack";

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

export function usePackProgress(secretOwed: boolean): PackProgress {
  const identity = usePackIdentity();
  const [dayKey, setDayKey] = useState(todayKey);
  const [now, setNow] = useState(() => Date.now());
  // The ROW, not the derived state. `secretOwed` can flip long after the read —
  // the pack pulls its secret the moment it is torn — and re-reading IndexedDB
  // for a question that is pure arithmetic over a row we already hold would
  // blank the card for a frame every time the secret query settles.
  //
  // `undefined` is "not read yet" and `null` is "read, and there is no pack",
  // which are different answers and only one of them is `loading`.
  const [row, setRow] = useState<PackState | null | undefined>(undefined);
  const [nonce, setNonce] = useState(0);

  const reread = useCallback(() => setNonce((n) => n + 1), []);

  /**
   * The day rolls over on a poll, not a timer, for the reason players.pack.tsx
   * gives for the same interval: a phone suspends timers when it sleeps, and the
   * one that mattered was always scheduled for exactly the moment the screen was
   * off. The poll doubles as the clock behind "Next pack in 6h" — hours, so once
   * a minute is more than enough.
   *
   * COMING BACK TO THE TAB RE-READS THE ROW, and that is not belt-and-braces.
   * The two events below cover a tear and nothing after it: `PACK_STATE_CHANGED`
   * is same-window only, and the localStorage mirror is written once per pack by
   * design (`markPackDealt` no-ops on an unchanged value), so every reveal AFTER
   * the first in another tab is silent here. Without this, a vault left open
   * beside the pack shows the count it had when the pack was torn, for the rest
   * of the day.
   */
  useEffect(() => {
    const check = () => {
      setNow(Date.now());
      setDayKey((prev) => {
        const next = todayKey();
        return prev === next ? prev : next;
      });
    };
    const onVisible = () => {
      check();
      // Only on the way back in. A read on the way out is a read nobody sees.
      if (document.visibilityState === "visible") reread();
    };
    const id = setInterval(check, DAY_TICK_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [reread]);

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
    // Cleared BEFORE the read, so a phone that has just changed hands — or a tab
    // that has just crossed midnight — says "I don't know yet" rather than going
    // on showing the last person's pack until IndexedDB answers.
    setRow(undefined);
    void loadPackState().then((next) => {
      if (cancelled) return;
      setRow(next);
    });
    return () => {
      cancelled = true;
    };
  }, [identity, dayKey, nonce]);

  if (row === undefined || identity == null) return { state: "loading", left: 0, now };
  const pack = todayPackState({ row, dayKey, identity, secretOwed });
  return { state: pack.state, left: pack.state === "torn" ? pack.left : 0, now };
}
