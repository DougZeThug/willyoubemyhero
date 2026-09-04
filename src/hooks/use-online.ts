import { useEffect, useState } from "react";

/**
 * The one sentence the app says about being offline, said the same way in both
 * places it appears: the banner above the tab bar, and the reason a spend button
 * has gone quiet.
 *
 * It leads with what still works, because that is the true and useful half — the
 * vault is IndexedDB and a query cache, and a pack opened in a dead spot is
 * dealt locally and recorded when the signal comes back (see the unrecorded-pull
 * row in use-my-collection.ts). Only the things that have to reach a server this
 * second are actually lost.
 */
export const OFFLINE_MESSAGE =
  "You're offline — the vault still works; packs record when you're back";

/**
 * Whether the device thinks it can reach the network.
 *
 * `navigator.onLine` is a weak signal: it means "an interface is up", not "the
 * server answers", and a captive-portal wifi reports true. That is why it is
 * only ever used here to EXPLAIN a wait and to grey out a control — never to
 * decide whether a request is worth making. A false negative would be the
 * damaging direction, and the browser does not produce those.
 *
 * Optimistic on the first render and settled in an effect, for the reason
 * use-photo-urls.ts spells out at length: `navigator` does not exist during SSR,
 * and a first paint that guessed would either flash the banner on every cold
 * load or mismatch the server's markup.
 */
export function useIsOnline(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const read = () => setOnline(navigator.onLine);
    // Read once here rather than in the initialiser: a device that was already
    // offline when the page loaded never fires either event.
    read();
    window.addEventListener("online", read);
    window.addEventListener("offline", read);
    return () => {
      window.removeEventListener("online", read);
      window.removeEventListener("offline", read);
    };
  }, []);

  return online;
}

/**
 * The same answer as `useIsOnline`, read once, outside a render.
 *
 * For code that outlives the component that scheduled it. A toast raised by a
 * route is mounted at the app ROOT, so its action can still fire after that
 * route has unmounted — and any React value its closure captured, a ref updated
 * by an effect included, has been frozen since. This asks the browser at the
 * moment of the tap instead.
 *
 * Guarded for the same reason the hook starts optimistic: `navigator` does not
 * exist during SSR, and nothing that runs there should decide it is offline.
 */
export function isOnlineNow(): boolean {
  return typeof navigator === "undefined" || navigator.onLine;
}

/**
 * What to spread onto a control that cannot run without a connection.
 *
 * THE BANNER IS WHAT ACTUALLY TELLS ANYBODY, and that is worth being clear
 * about: these controls are natively `disabled`, and a disabled button does not
 * dispatch pointer events, so the `title` will not raise a tooltip on most
 * browsers. It is set anyway because it costs nothing and some do.
 *
 * `aria-description` is the half that earns its place. A disabled control stays
 * in the accessibility tree — it leaves the tab order, it is not removed — so a
 * screen reader arrowing over the button reads the reason on the button rather
 * than having to go and find the banner.
 *
 * The alternative, `aria-disabled` with a click guard, keeps the control
 * focusable and makes the tooltip work, at the cost of a button that takes
 * focus and does nothing. Not worth it while a banner is on screen saying the
 * same sentence.
 */
export function offlineReason(offline: boolean) {
  return offline ? { title: OFFLINE_MESSAGE, "aria-description": OFFLINE_MESSAGE } : {};
}
