import { useCallback, useEffect, useState } from "react";
import { usePackIdentity } from "@/lib/device-id";
import { loadPackState, type PackState } from "@/lib/card-collection";
import { usePackSignals } from "./use-pack-signals";
import { leagueDay } from "@/lib/league-day";
import { todayPackState } from "@/lib/pack";
import { DAY_TICK_MS } from "@/lib/pack-ceremony";

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

export function usePackProgress(): PackProgress {
  const identity = usePackIdentity();
  const [dayKey, setDayKey] = useState(leagueDay);
  const [now, setNow] = useState(() => Date.now());
  // The ROW, not the derived state: the answer is pure arithmetic over a row
  // we already hold, and re-reading IndexedDB for it would blank the card for a
  // frame on every re-render.
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
   * off. The day is the league's (`leagueDay`), so this and the pack screen agree
   * about when a row stops being today's. The poll doubles as the clock behind
   * "Next pack in 6h" — hours, so once a minute is more than enough.
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
        const next = leagueDay();
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

  // This tab's own write is what carries a tear back to a vault left open behind
  // the pack screen; the mirror key is the OTHER tab.
  usePackSignals({ changedHere: reread, dealtElsewhere: reread });

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
  const pack = todayPackState({ row, dayKey, identity });
  return { state: pack.state, left: pack.state === "torn" ? pack.left : 0, now };
}
