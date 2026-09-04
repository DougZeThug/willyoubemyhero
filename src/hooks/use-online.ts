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
 * What to spread onto a control that cannot run without a connection.
 *
 * Both attributes, and deliberately: `title` is the tooltip a desktop pointer
 * gets, `aria-description` is the one a screen reader reads out. A disabled
 * button with no stated reason is the failure this exists to avoid — the
 * audit's §19 line about offline being shown "nothing at all".
 */
export function offlineReason(offline: boolean) {
  return offline ? { title: OFFLINE_MESSAGE, "aria-description": OFFLINE_MESSAGE } : {};
}
