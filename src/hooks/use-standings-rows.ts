import { useMemo } from "react";
import {
  standings,
  type StandingsBundle,
  type StandingsParticipant,
  type StandingsRun,
} from "@/lib/standings";

/**
 * `standings()` joined to the roster. `ep` is undefined when the roster read
 * failed (a bundle coalesces that to []) or the run belongs to someone no longer
 * on it, so callers that cannot render a nameless row filter on it themselves.
 */
export function standingsRows<P extends StandingsParticipant, R extends StandingsRun>(
  bundle: StandingsBundle<P, R> | null | undefined,
) {
  const parts = bundle?.participants ?? [];
  return standings(bundle).map((s) => ({
    run: s.run,
    place: s.place,
    ep: parts.find((p) => p.participant_id === s.participantId),
  }));
}

export function useStandingsRows<P extends StandingsParticipant, R extends StandingsRun>(
  bundle: StandingsBundle<P, R> | null | undefined,
) {
  return useMemo(() => standingsRows(bundle), [bundle]);
}
