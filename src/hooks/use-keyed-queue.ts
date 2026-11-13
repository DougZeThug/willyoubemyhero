import { useRef } from "react";
import { useIdSet } from "@/hooks/use-id-set";

/**
 * One serial chain of saves per key, with `pending(key)` true from the first
 * enqueue until the last one queued for that key settles.
 *
 * Arrow keys walk a swatch strip and fire a save per step, so a key can genuinely
 * have two writes outstanding. Unchained, the row settles on whichever the network
 * delivered last rather than on the last key pressed, and whichever landed first
 * clears the spinner with the other still in the air. The chain lives in a ref,
 * not state: nothing renders from it.
 *
 * A task that throws is swallowed here so the saves queued behind it still run;
 * a task that wants to tell the person (a toast) does so itself.
 */
export function useKeyedQueue() {
  const pending = useIdSet();
  const chains = useRef(new Map<string, Promise<unknown>>());

  function enqueue(key: string, task: () => Promise<unknown>) {
    pending.add(key);
    const run: Promise<unknown> = (chains.current.get(key) ?? Promise.resolve<unknown>(undefined))
      .then(task)
      .catch(() => {})
      .finally(() => {
        if (chains.current.get(key) !== run) return;
        chains.current.delete(key);
        pending.remove(key);
      });
    chains.current.set(key, run);
  }

  return { pending: pending.has, enqueue };
}
