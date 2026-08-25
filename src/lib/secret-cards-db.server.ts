// A supabase client that will talk to tables `types.ts` has never heard of.
//
// src/integrations/supabase/types.ts is `supabase gen types` output, must not be
// hand-edited, and is .prettierignore'd — so `secret_cards`, `secret_card_pulls`,
// `card_pulls` and `pack_opens`, along with `pull_secret_card`, `secret_pull_status`,
// `record_card_pulls` and `record_pack_open`, are invisible to the typed client
// until somebody regenerates it,
// long after this lands. `.from("secret_cards")` and `.rpc("pull_secret_card")`
// are compile errors against the generated Database type, and `Database` is a
// type alias rather than an interface, so declaration merging cannot rescue it.
//
// Rather than hand-write a Database slice (whose exact shape depends on
// supabase-js generic arity that has moved across 2.x minors), widen to the
// ungenericised client and recover shape per query with `.returns<T>()` /
// `.maybeSingle<T>()`, which is already the house style in social.functions.ts.
// It is not `any` in our source, so @typescript-eslint/no-explicit-any is happy.
//
// DELETE THIS FILE once types.ts has been regenerated against a project with
// 20260728143000_secret_holo_cards.sql, 20260728160000_player_card_pulls.sql,
// 20260731120000_pack_opens.sql, 20260802120000_secret_card_border_fx.sql and
// 20260813120000_card_pull_editions.sql
// applied: every call site then switches to plain `supabaseAdmin` unchanged.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompletedCollection } from "./collection-trophies";
// A top-level client.server import is safe here and nowhere else: this is a
// *.server.ts module, so it never reaches the client bundle.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type SecretCardRow = {
  id: string;
  name: string;
  flavour: string | null;
  foil: string;
  border_fx: string;
  /** Set the card is filed into. Null for every card authored before sets existed. */
  collection: string | null;
  art_path: string | null;
  back_path: string | null;
  active: boolean;
  weight: number;
  created_at: string;
  updated_at: string;
};

/** A set, as authored in the admin panel. Ids are stored on secret_cards.collection. */
export type SecretCollectionRow = {
  id: string;
  label: string;
  sort_order: number;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type SecretPullRow = {
  id: string;
  participant_id: string;
  secret_card_id: string;
  pulled_on: string;
  event_id: string | null;
  is_duplicate: boolean;
  granted: boolean;
  /**
   * Level of this copy. Unconstrained text — the ids live in secret-rarity.ts,
   * which falls back to `common` for anything it does not recognise.
   */
  tier: string;
  created_at: string;
};

/** What public.pull_secret_card returns. Null when nothing is pullable. */
export type PullSecretCardResult = {
  pullId: string;
  cardId: string;
  day: string;
  duplicate: boolean;
  tier: string;
  fresh: boolean;
  /**
   * Dust this pull just paid, or null.
   *
   * 25 on a duplicate, 0 on a fresh card, and NULL on the `fresh: false` returns
   * — those describe a pull that already happened and already paid, and repeating
   * the number would have the ceremony announce it twice. Always 0 for a guest:
   * dust_ledger is keyed on a participant.
   */
  dust: number | null;
  /**
   * The set this pull just finished, or null — which is every pull but one.
   *
   * The single place in this feature a set SIZE crosses the wire, and it only
   * ever describes a set that is already complete. Present on the `fresh: false`
   * returns too, always null: they acquired nothing, and one shape is easier to
   * reason about than an optional key.
   */
  completedCollection: CompletedCollection | null;
} | null;

/** What public.secret_pull_status returns. Note the absence of a set size. */
export type SecretPullStatusResult = {
  day: string;
  pulledToday: boolean;
  pulled: number;
  available: boolean;
  resetsAt: string;
};

export type CardPullRow = {
  participant_id: string;
  event_participant_id: string;
  pull_count: number;
  /**
   * Best finish this person has ever pulled of this card. An unconstrained text
   * column — the ids live in card-edition.ts, which falls back to standard for
   * anything it does not recognise.
   */
  edition: string;
  first_pulled_at: string;
  last_pulled_at: string;
};

export type PackOpenRow = {
  participant_id: string;
  opened_on: string;
  event_id: string | null;
  card_count: number;
  created_at: string;
};

export function secretsDb(): SupabaseClient {
  return supabaseAdmin as unknown as SupabaseClient;
}
