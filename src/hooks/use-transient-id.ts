import { useEffect, useState } from "react";

/** An id that is set, then clears itself after `ms` — a flash or highlight on one row. */
export function useTransientId(ms: number) {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    if (!id) return;
    const t = setTimeout(() => setId(null), ms);
    return () => clearTimeout(t);
  }, [id, ms]);
  return [id, setId] as const;
}
