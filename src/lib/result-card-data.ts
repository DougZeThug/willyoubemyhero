import type { ResultCardData } from "@/components/result-card";
import type { ImageUrlSet } from "@/lib/media";

type PhotoValue = ImageUrlSet | string | null | undefined;

/**
 * What the share card prints for one leaderboard row.
 *
 * Pure so the screen can take it as a snapshot at tap time: the card must show
 * the numbers the tapped row had, not whatever the live bundle says by the time
 * the export has painted.
 */
export function toResultCardData({
  row,
  event,
  bundle,
  photos,
}: {
  row: {
    run: { id: string; official_time_ms: number | null; penalty_ms?: number | null };
    place: number;
    ep?: {
      id: string;
      participant?: {
        name: string;
        fantasy_team_name?: string | null;
        profile_image_url?: ImageUrlSet | string | null;
      } | null;
    };
  };
  event: { name: string | null; year: number | null } | null | undefined;
  bundle:
    | {
        splits: {
          id: string;
          run_id: string;
          station_id: string;
          segment_time_ms: number | null;
        }[];
        stations: { id: string; name: string }[];
      }
    | null
    | undefined;
  photos: Record<string, PhotoValue> | null | undefined;
}): ResultCardData {
  const { run, place, ep } = row;
  return {
    eventName: event?.name ?? "Draft Combine",
    eventYear: event?.year ?? null,
    participantName: ep?.participant?.name ?? "Athlete",
    fantasyTeam: ep?.participant?.fantasy_team_name ?? null,
    photoUrl: photos?.[ep?.id ?? ""] ?? ep?.participant?.profile_image_url ?? null,
    totalMs: run.official_time_ms ?? 0,
    penaltyMs: run.penalty_ms ?? 0,
    rank: place,
    splits: (bundle?.splits ?? [])
      .filter((s) => s.run_id === run.id)
      .map((s) => ({
        id: s.id,
        label: bundle?.stations.find((st) => st.id === s.station_id)?.name ?? "Split",
        ms: s.segment_time_ms ?? 0,
      })),
  };
}
