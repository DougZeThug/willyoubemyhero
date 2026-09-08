// A supabase client that will talk to tables `types.ts` has never heard of.
//
// src/integrations/supabase/types.ts is `supabase gen types` output, must not be
// hand-edited, and is .prettierignore'd — so `secret_cards`, `secret_card_pulls`,
// `card_pulls` and `pack_opens`, along with `open_pack`, `pack_status`,
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
  /** A SET_ACCENTS preset id, or null for no theme. */
  accent: string | null;
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
  /** When this pull entered its current holder's collection. See CardCopyRow. */
  acquired_at: string;
};

/** A roster slot as public.open_pack stores it. The finish fields are a member's only. */
export type OpenPackRosterSlot = {
  kind: "roster";
  id: string;
  /** Null when the mint was rationed or the id unknown, and always for a guest. */
  edition?: string | null;
  heldBefore?: number;
  editionBefore?: string | null;
};

/** A secret slot as public.open_pack stores it. */
export type OpenPackSecretSlot = {
  kind: "secret";
  id: string;
  pullId: string;
  tier: string;
  duplicate: boolean;
  /** The level of the copy already owned, when `duplicate`. */
  tierBefore: string | null;
  /**
   * The set this slot just finished, or null — which is every slot but one.
   *
   * The single place in this feature a set SIZE crosses the wire, and it only
   * ever describes a set that is already complete. Stored on the slot so the
   * replay of an already-opened pack answers it again.
   */
  completedCollection: CompletedCollection | null;
};

/** What public.open_pack returns. Null when nothing at all is dealable. */
export type OpenPackResult = {
  day: string;
  fresh: boolean;
  packsOpened: number;
  cards: (OpenPackRosterSlot | OpenPackSecretSlot)[];
} | null;

/** What public.pack_status returns. Note the absence of a set size. */
export type PackStatusResult = {
  day: string;
  openedToday: boolean;
  secretsOwned: number;
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
  /** The dealt slots, written once by open_pack. Null on rows from before it. */
  cards: unknown | null;
  created_at: string;
};

export function secretsDb(): SupabaseClient {
  return supabaseAdmin as unknown as SupabaseClient;
}
