import { useCallback, useState } from "react";

/**
 * A set of ids that are in flight, as a Set rather than a single id: two rows
 * can genuinely be pending at once, and one row finishing must not take the
 * other's spinner down (nor, for a tile that reads its own flag to decide when
 * to let go of what was typed, put a stale value back mid-flight).
 */
export function useIdSet() {
  const [ids, setIds] = useState<ReadonlySet<string>>(new Set());
  const add = useCallback((id: string) => setIds((prev) => new Set(prev).add(id)), []);
  const remove = useCallback(
    (id: string) =>
      setIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      }),
    [],
  );
  const has = useCallback((id: string) => ids.has(id), [ids]);
  return { has, add, remove };
}
