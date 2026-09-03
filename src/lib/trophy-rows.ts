// The row shape of the trophy table.
//
// The client shim this file used to open is gone: types.ts now covers
// `collection_trophies`, so the call site is on the typed supabaseAdmin. The row
// type stays for the readers that pass it around.
export type CollectionTrophyRow = {
  participant_id: string;
  collection_id: string;
  completed_on: string;
  size_at_completion: number;
  /** Unconstrained here; the CHECK lives in the migration and TrophyVia mirrors it. */
  via: string;
  event_id: string | null;
  created_at: string;
};
