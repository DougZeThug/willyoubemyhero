import { useEffect, useRef } from "react";
import { PACK_STATE_CHANGED } from "@/lib/card-collection";
import { STORAGE_KEYS } from "@/lib/storage-keys";

type PackSignalHandlers = {
  /** This tab wrote the pack row or the unrecorded row. */
  changedHere?: () => void;
  /** Another tab dealt (or cleared) the pack — `storage` on the mirror key. */
  dealtElsewhere?: () => void;
  /** Another tab moved the unrecorded row. */
  unrecordedElsewhere?: () => void;
};

/**
 * Everything that can say "the pack changed", for a screen that is not the one
 * changing it.
 *
 * Neither half covers the other. `PACK_STATE_CHANGED` is a `window` event, so it
 * never leaves the tab that wrote; IndexedDB fires nothing across tabs at all; and
 * `storage` only reports OTHER tabs, on the two localStorage keys that shadow the
 * rows. A null key is `localStorage.clear()`, which concerns both.
 *
 * Handlers are read through a ref, so a caller can pass fresh closures every
 * render without re-subscribing.
 */
export function usePackSignals(handlers: PackSignalHandlers) {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });

  useEffect(() => {
    const here = () => latest.current.changedHere?.();
    const elsewhere = (e: StorageEvent) => {
      if (e.key === null || e.key === STORAGE_KEYS.packDealt) latest.current.dealtElsewhere?.();
      if (e.key === null || e.key === STORAGE_KEYS.packUnrecorded) {
        latest.current.unrecordedElsewhere?.();
      }
    };
    window.addEventListener(PACK_STATE_CHANGED, here);
    window.addEventListener("storage", elsewhere);
    return () => {
      window.removeEventListener(PACK_STATE_CHANGED, here);
      window.removeEventListener("storage", elsewhere);
    };
  }, []);
}
