import { useEffect, useRef } from "react";

type Bundle = {
  participants: Array<{ id: string; participant_id: string; participant?: { name: string } | null }>;
  runs: Array<{ id: string; participant_id: string; is_official: boolean; official_time_ms: number | null }>;
};

export type FinishPayload = { name: string; timeMs: number; deltaMs: number };

export function useFinishWatcher(
  bundle: Bundle | null | undefined,
  onFinish: (payload: FinishPayload) => void,
) {
  const seen = useRef<Set<string>>(new Set());
  const initialized = useRef(false);
  useEffect(() => {
    if (!bundle) return;
    const official = bundle.runs.filter((r) => r.is_official);
    if (!initialized.current) {
      official.forEach((r) => seen.current.add(r.id));
      initialized.current = true;
      return;
    }
    const sorted = [...official].sort(
      (a, b) => (a.official_time_ms ?? 0) - (b.official_time_ms ?? 0),
    );
    const leaderMs = sorted[0]?.official_time_ms ?? 0;
    for (const r of official) {
      if (seen.current.has(r.id)) continue;
      seen.current.add(r.id);
      const ep = bundle.participants.find((p) => p.participant_id === r.participant_id);
      onFinish({
        name: ep?.participant?.name ?? "Athlete",
        timeMs: r.official_time_ms ?? 0,
        deltaMs: Math.max(0, (r.official_time_ms ?? 0) - leaderMs),
      });
    }
  }, [bundle, onFinish]);
}