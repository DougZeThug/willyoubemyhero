import { createServerFn } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { optionalActor, requireActor } from "./require-auth.server";
import { requireLeagueAdmin } from "./league-admin.server";
import { decodeImageDataUrl, forgetSignedPath, signPath } from "./media.functions";
import { VARIANT_WIDTHS } from "./media";
import type {
  PullSecretCardResult,
  SecretCardRow,
  SecretCollectionRow,
  SecretPullRow,
  SecretPullStatusResult,
} from "./secret-cards-db.server";
import type { SecretCardView } from "./secret-cards";
import {
  SECRET_BORDER_FX_OPTIONS,
  SECRET_COLLECTION_ID_PATTERN,
  SECRET_FOIL_OPTIONS,
} from "./secret-cards";
import { bestSecretTier, toSecretTier } from "./secret-rarity";

/**
 * The daily secret card: a permanent league collection nobody can browse.
 *
 * INVARIANT: no member-facing handler in this file may ever accept a secret card
 * id. Every path that mints a secret's signed URL derives its id set server-side —
 * from the RPC's return value, or from this member's own ledger. That is why a
 * member cannot ask for a card they have not pulled: there is no parameter to
 * abuse. A filter is one refactor away from being dropped; a missing parameter is
 * not. If a future "share this card" feature needs an id, it needs a new threat
 * model first.
 *
 * The daily limit is enforced by a unique index and a row lock inside
 * pull_secret_card, not here. card-collection.ts deliberately lets a device with
 * IndexedDB blocked open a fresh pack every load; secrets must not inherit that,
 * and server-side uniqueness is what closes it.
 */

/** Typed client, for tables the generated types already know about. */
async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Untyped client, for the two tables types.ts has not been regenerated for. */
async function secrets() {
  const { secretsDb } = await import("./secret-cards-db.server");
  return secretsDb();
}

/**
 * Admin rights over a catalogue that has no event of its own.
 *
 * deleteComment authorizes a delete against the comment's own event, so an admin
 * for event A cannot touch event B. There is no row-side event here — the set is
 * league-wide by design — so the nearest honest equivalent is "admin of the
 * current combine", resolved server-side rather than taken from the payload. Last
 * year's PIN, still a valid 12-hour token if someone left a tab open, cannot edit
 * this year's set, and no handler in this file takes an eventId at all.
 *
 * What this is NOT: any holder of the active event's shared PIN can rewrite or
 * retire the league's permanent collection, including cards authored years
 * earlier. For a thirteen-person league that is the intended blast radius.
 *
 * Requires an active event, so out of season nobody can author secrets. That is a
 * real product constraint, stated here rather than discovered in a garden.
 */
/**
 * These responses vary only by a request header, and a cache hit here is a
 * spoiler rather than a cosmetic bug. Latent today — Cloudflare does not cache
 * Worker responses by default — but this is the first endpoint in the app where
 * it would matter.
 */
function noStore() {
  setResponseHeader("Cache-Control", "private, no-store");
}

/** Storage path for a card's art. Never the name, never a slug — see below. */
function artPath(cardId: string, ext: string) {
  // A signed URL carries its path in plaintext, so `secrets/07-the-dog.webp`
  // would hand anyone who pulled one card both the joke and the size of the set.
  // The bucket grants SELECT to service_role only, so it cannot be listed either.
  return `secrets/${cardId}/art-${Date.now()}.${ext}`;
}

function toView(
  row: SecretCardRow,
  artUrl: string | null,
  backUrl: string | null,
  tier: string,
): SecretCardView {
  return {
    id: row.id,
    name: row.name,
    flavour: row.flavour,
    foil: row.foil,
    borderFx: row.border_fx,
    collection: row.collection ?? null,
    artUrl,
    backUrl,
    // The level belongs to the copy, never to the card row — two people can hold
    // the same secret at two different levels, which is the whole point.
    tier: toSecretTier(tier),
  };
}

async function signCard(row: SecretCardRow, tier: string) {
  // Originals are multi-megabyte PNGs; the renderer hands back a WebP a fraction
  // of the size at the biggest width the card is ever shown at.
  const [artUrl, backUrl] = await Promise.all([
    signPath(row.art_path, VARIANT_WIDTHS.large),
    signPath(row.back_path, VARIANT_WIDTHS.large),
  ]);
  return toView(row, artUrl, backUrl, tier);
}

// ------- Member-facing -------

/**
 * Today's secret card. Takes no input at all: whoever is asking comes from a
 * verified token and the card is chosen by Postgres.
 *
 * Guests get one too, keyed on a server-minted `g.` token rather than a
 * participant. The id is never read from the payload for either kind — that is
 * the entire reason the guest identity is signed rather than just a device id.
 *
 * Calling twice in one league day returns the same card with `fresh: false`
 * rather than failing, so a double-tap or a retried request resumes the reveal.
 */
export const pullSecretCard = createServerFn({ method: "POST" }).handler(async () => {
  const actor = requireActor();
  noStore();
  const sb = await admin();
  const db = await secrets();

  // Stamped on the pull for flavour only. A pull out of season is fine, so a
  // missing active event is not an error.
  const { data: event } = await sb
    .from("events")
    .select("id")
    .eq("active", true)
    .order("year", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await db.rpc("pull_secret_card", {
    _participant_id: actor.kind === "member" ? actor.id : null,
    _guest_id: actor.kind === "guest" ? actor.id : null,
    _event_id: event?.id ?? null,
  });
  if (error) throw new Error(error.message);

  const pull = data as PullSecretCardResult;
  // Nothing pullable — no cards yet, or every one of them still missing its art.
  // Soft, so the pack screen can say "nothing today" instead of showing an error.
  if (!pull) return { ok: false as const, reason: "unavailable" as const };

  const { data: card } = await db
    .from("secret_cards")
    .select("*")
    .eq("id", pull.cardId)
    .maybeSingle<SecretCardRow>();
  if (!card) return { ok: false as const, reason: "unavailable" as const };

  return {
    ok: true as const,
    day: pull.day,
    duplicate: pull.duplicate,
    fresh: pull.fresh,
    card: await signCard(card, pull.tier),
  };
});

/**
 * Whether there is a card waiting today. A pure read — opening the pack screen
 * must never spend the drop.
 *
 * Answers for a device with no identity at all too, with everything false, so the
 * pack screen can render before a guest session exists without this throwing.
 *
 * `claimed` is a misnomer kept on purpose. It has always driven "is there a drop
 * for you", and now that a guest has one too it means "has an identity that can
 * pull" rather than "has claimed a player". Renaming it would ripple through the
 * exact-key assertions that keep a set size out of this response, for no gain.
 */
export const getSecretStatus = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  const actor = optionalActor();
  if (!actor) {
    return {
      claimed: false as const,
      day: null,
      pulledToday: false,
      pulled: 0,
      available: false,
      resetsAt: null,
    };
  }
  const db = await secrets();
  const { data, error } = await db.rpc("secret_pull_status", {
    _participant_id: actor.kind === "member" ? actor.id : null,
    _guest_id: actor.kind === "guest" ? actor.id : null,
  });
  if (error) throw new Error(error.message);
  const status = data as SecretPullStatusResult;
  return { claimed: true as const, ...status };
});

/**
 * The secrets whoever is asking has pulled, and only those.
 *
 * Deactivated cards are deliberately not filtered out: you pulled it, you keep
 * it. Retiring a card removes it from future pulls, never from somebody's vault.
 */
export const getMySecrets = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  // Mirrors getSecretStatus: a device with no identity yet (or one whose token
  // has just expired) owns nothing — that is an empty vault, not an error. This
  // used to throw and blank the screen on the very first paint of the vault.
  const actor = optionalActor();
  if (!actor) return { cards: [], pulled: 0 };
  const db = await secrets();

  const { data: pulls, error } = await db
    .from("secret_card_pulls")
    .select("secret_card_id, pulled_on, is_duplicate, tier")
    .eq(actor.kind === "member" ? "participant_id" : "guest_id", actor.id)
    .order("pulled_on", { ascending: false })
    .returns<Pick<SecretPullRow, "secret_card_id" | "pulled_on" | "is_duplicate" | "tier">[]>();
  if (error) throw error;

  // Ownership comes from the non-duplicate rows; duplicates only bump the count.
  const owned = new Map<string, { firstPulledOn: string; count: number; tier: string }>();
  for (const p of pulls ?? []) {
    const seen = owned.get(p.secret_card_id);
    if (seen) {
      seen.count += 1;
      // Ordered newest first, so every later row is older than the one held.
      seen.firstPulledOn = p.pulled_on;
      // Best wins across every copy, so a duplicate that rolled better shows the
      // better level even if the owning row has not been upgraded yet.
      seen.tier = bestSecretTier(seen.tier, p.tier);
    } else {
      owned.set(p.secret_card_id, {
        firstPulledOn: p.pulled_on,
        count: 1,
        tier: toSecretTier(p.tier),
      });
    }
  }
  if (owned.size === 0) return { cards: [], pulled: 0 };

  const ownedIds = [...owned.keys()];
  const [{ data: rows }, { data: allPulls }] = await Promise.all([
    db.from("secret_cards").select("*").in("id", ownedIds).returns<SecretCardRow[]>(),
    // The `.in(...)` is load-bearing, not an optimisation. Without it this reads
    // the whole ledger and the size of the set is sitting in a local variable one
    // careless `return` away from the wire — the exact failure the INVARIANT at
    // the top of this file exists to prevent.
    //
    // secret_card_pulls_owned_once and its guest twin together make at most one
    // non-duplicate row per identity per card, so counting rows here IS counting
    // people — guests among them, which is the point of them having identities.
    db
      .from("secret_card_pulls")
      .select("secret_card_id")
      .in("secret_card_id", ownedIds)
      .eq("is_duplicate", false)
      .returns<Pick<SecretPullRow, "secret_card_id">[]>(),
  ]);

  const owners = new Map<string, number>();
  for (const p of allPulls ?? []) {
    owners.set(p.secret_card_id, (owners.get(p.secret_card_id) ?? 0) + 1);
  }

  const cards = await Promise.all(
    (rows ?? []).map(async (row) => ({
      ...(await signCard(row, owned.get(row.id)!.tier)),
      firstPulledOn: owned.get(row.id)!.firstPulledOn,
      count: owned.get(row.id)!.count,
      // How many people have found this one. A count of 1 means you are the only
      // person who ever has — a statement about your card, which leaks nothing
      // about the cards you have not seen.
      ownerCount: owners.get(row.id) ?? 1,
    })),
  );
  // Newest pull first, so the card you just turned over is at the front.
  cards.sort((a, b) => b.firstPulledOn.localeCompare(a.firstPulledOn));
  // `pulled` is how many this member owns, and `ownerCount` is a count of people.
  // Neither is a set size: there is still no denominator over the SET anywhere in
  // this response, and adding one would give away how many secrets exist.
  return { cards, pulled: cards.length };
});

// ------- Admin -------

/**
 * The whole catalogue, with how many people have found each card.
 *
 * Guarded, unlike the read-only handlers in media.functions.ts — this one returns
 * the set. The owner counts are the one thing that escapes the silence rule: the
 * admin authored these cards, and without the counts they cannot tell when the
 * league has exhausted the set and it is time to upload more.
 */
export const listSecretCards = createServerFn({ method: "GET" }).handler(async () => {
  await requireLeagueAdmin();
  noStore();
  const sb = await admin();
  const db = await secrets();

  const [{ data: rows }, { data: pulls }, { count: claimedCount }] = await Promise.all([
    db
      .from("secret_cards")
      .select("*")
      .order("created_at", { ascending: true })
      .returns<SecretCardRow[]>(),
    db
      .from("secret_card_pulls")
      .select("secret_card_id, participant_id, is_duplicate")
      .eq("is_duplicate", false)
      .returns<Pick<SecretPullRow, "secret_card_id" | "participant_id">[]>(),
    // Claimed, not issued. Counting every code printed would include people who
    // never used one, and `exhausted` below is measured against this number.
    sb
      .from("member_codes")
      .select("participant_id", { count: "exact", head: true })
      .not("claimed_at", "is", null),
  ]);

  // Two counts, because they answer different questions. `owners` is how many
  // people hold a card — guests included, matching the number everyone else sees.
  // `memberOwners` is the one `exhausted` is measured with, because it is
  // compared against the claimed-member count: guests would push it over the line
  // while members still had cards to find, and the panel would go quiet early.
  const owners = new Map<string, number>();
  const memberOwners = new Map<string, number>();
  for (const p of pulls ?? []) {
    owners.set(p.secret_card_id, (owners.get(p.secret_card_id) ?? 0) + 1);
    if (p.participant_id) {
      memberOwners.set(p.secret_card_id, (memberOwners.get(p.secret_card_id) ?? 0) + 1);
    }
  }

  const claimed = claimedCount ?? 0;
  const cards = await Promise.all(
    (rows ?? []).map(async (row) => ({
      id: row.id,
      name: row.name,
      flavour: row.flavour,
      foil: row.foil,
      borderFx: row.border_fx,
      active: row.active,
      weight: row.weight,
      collection: row.collection ?? null,
      hasArt: !!row.art_path,
      artUrl: await signPath(row.art_path, VARIANT_WIDTHS.medium),
      ownerCount: owners.get(row.id) ?? 0,
    })),
  );

  // Mirrors pull_secret_card's WHERE clause: weight 0 takes a card out of the
  // daily draw without retiring it, so it can never be "found" and must not
  // hold the set back from reading as exhausted.
  const pullable = cards.filter((c) => c.active && c.hasArt && c.weight > 0);

  // Roster for the grant control: id + display name only, sorted for the picker.
  // Kept on this response so the panel needs no second round trip; the admin
  // already sees the whole set here, so exposing the roster is not a new leak.
  const { data: rosterRows } = await sb
    .from("participants")
    .select("id, name, nickname")
    .eq("active", true)
    .order("name", { ascending: true });
  const participants = (rosterRows ?? []).map((p) => ({
    id: p.id as string,
    name: (p.nickname as string | null) || (p.name as string),
  }));

  // Every set, hidden ones included: this is the screen where they are managed.
  const { data: collectionRows } = await db
    .from("secret_collections")
    .select("id, label, sort_order, active")
    .order("sort_order", { ascending: true })
    .order("label", { ascending: true })
    .returns<SecretCollectionRow[]>();
  const collections = (collectionRows ?? []).map((c) => ({
    id: c.id,
    label: c.label,
    sortOrder: c.sort_order,
    active: c.active,
  }));

  return {
    cards,
    collections,
    claimedMembers: claimed,
    // Everyone who could pull has pulled everything there is. The panel says so,
    // because otherwise the admin has no way to know the daily drop has gone
    // quiet and turned into nothing but duplicates.
    exhausted:
      claimed > 0 &&
      pullable.length > 0 &&
      pullable.every((c) => (memberOwners.get(c.id) ?? 0) >= claimed),
    participants,
  };
});

const cardName = z.string().trim().min(1).max(60);
const cardFlavour = z.string().trim().max(240);
// The columns carry no CHECK, so these enums are the whole enforcement layer —
// derived from the same option lists the panel renders, so the two cannot drift.
const cardFoil = z.enum(SECRET_FOIL_OPTIONS.map((o) => o.id) as [string, ...string[]]);
const cardBorderFx = z.enum(SECRET_BORDER_FX_OPTIONS.map((o) => o.id) as [string, ...string[]]);
// Same cap as every other upload path: base64 expands by 4/3, so this is the
// 8.8 MB the client-side check enforces before encoding.
const cardArt = z.string().min(32).max(12_000_000);
// Sets are data now, so this validates the *shape* of an id and existence is
// checked against secret_collections by assertCollections below. Nullable rather
// than just optional wherever it appears: clearing a card back to unsorted is a
// real edit, and `undefined` already means "leave it alone" in updateSecretCard.
const cardCollection = z.string().trim().regex(SECRET_COLLECTION_ID_PATTERN);
const collectionLabel = z.string().trim().min(1).max(40);

/**
 * Reject set ids nobody authored.
 *
 * The column is unconstrained text, so without this a typo'd id would file a card
 * into a set that renders as its own slug and can never be found again.
 */
async function assertCollections(ids: readonly (string | null | undefined)[]) {
  const wanted = [...new Set(ids.filter((i): i is string => !!i))];
  if (wanted.length === 0) return;
  const db = await secrets();
  const { data, error } = await db
    .from("secret_collections")
    .select("id")
    .in("id", wanted)
    .returns<{ id: string }[]>();
  if (error) throw error;
  const known = new Set((data ?? []).map((r) => r.id));
  const missing = wanted.filter((id) => !known.has(id));
  if (missing.length) throw new Error(`Unknown card set: ${missing.join(", ")}`);
}

/** The sets, in the order the admin arranged them. Hidden ones are left out. */
export const getSecretCollections = createServerFn({ method: "GET" }).handler(async () => {
  const db = await secrets();
  const { data, error } = await db
    .from("secret_collections")
    .select("id, label, sort_order, active")
    .eq("active", true)
    .order("sort_order", { ascending: true })
    .order("label", { ascending: true })
    .returns<SecretCollectionRow[]>();
  if (error) throw error;
  // Names of sets, never their sizes: this says nothing about what is inside one,
  // so the silence rule at the top of this file still holds for a member.
  return { collections: (data ?? []).map((c) => ({ id: c.id, label: c.label })) };
});

/** Create a set. The id is derived from the name once, then never changes. */
export const createSecretCollection = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ label: collectionLabel }).parse(d))
  .handler(async ({ data }) => {
    await requireLeagueAdmin();
    const { toSecretCollectionId } = await import("./secret-cards");
    const id = toSecretCollectionId(data.label);
    if (!SECRET_COLLECTION_ID_PATTERN.test(id)) {
      return { ok: false as const, reason: "bad_name" as const };
    }
    const db = await secrets();
    const { data: existing } = await db
      .from("secret_collections")
      .select("id")
      .eq("id", id)
      .maybeSingle<{ id: string }>();
    if (existing) return { ok: false as const, reason: "exists" as const };

    // Land at the bottom of the list; reordering is a separate, explicit edit.
    const { data: last } = await db
      .from("secret_collections")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle<{ sort_order: number }>();

    const { error } = await db
      .from("secret_collections")
      .insert({ id, label: data.label, sort_order: (last?.sort_order ?? 0) + 10 });
    if (error) throw error;
    return { ok: true as const, id, label: data.label };
  });

/** Rename, reorder or hide a set. The id is never touched — rows point at it. */
export const updateSecretCollection = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        id: cardCollection,
        label: collectionLabel.optional(),
        sortOrder: z.number().int().min(0).max(100_000).optional(),
        active: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await requireLeagueAdmin();
    const patch: { label?: string; sort_order?: number; active?: boolean } = {};
    if (data.label !== undefined) patch.label = data.label;
    if (data.sortOrder !== undefined) patch.sort_order = data.sortOrder;
    if (data.active !== undefined) patch.active = data.active;
    if (Object.keys(patch).length === 0) return { ok: true as const };

    const db = await secrets();
    const { data: row, error } = await db
      .from("secret_collections")
      .update(patch)
      .eq("id", data.id)
      .select("id")
      .maybeSingle<{ id: string }>();
    if (error) throw error;
    if (!row) return { ok: false as const, reason: "not_found" as const };
    return { ok: true as const };
  });

/**
 * Remove a set, but only an empty one.
 *
 * Deleting a set with cards in it would leave those rows pointing at an id with
 * no label — they would render as a raw slug and lose their shelf. Hiding is the
 * answer for a set that has served its purpose.
 */
export const deleteSecretCollection = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: cardCollection }).parse(d))
  .handler(async ({ data }) => {
    await requireLeagueAdmin();
    const db = await secrets();
    const { count } = await db
      .from("secret_cards")
      .select("id", { count: "exact", head: true })
      .eq("collection", data.id);
    if ((count ?? 0) > 0) return { ok: false as const, reason: "in_use" as const, cards: count };

    const { error } = await db.from("secret_collections").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true as const };
  });

/**
 * Add cards to the set. Bulk, because the alternative is twelve rounds of pick-
 * file-type-name-tap-save on a phone the night before, which does not happen.
 *
 * Each card is inserted before its art is uploaded, so a failed upload leaves a
 * row with no art_path. pull_secret_card skips those: an artless card must never
 * be pullable or it burns somebody's once-a-day pull on a blank.
 */
export const createSecretCards = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        cards: z
          .array(
            z.object({
              name: cardName,
              flavour: cardFlavour.optional(),
              collection: cardCollection.optional(),
              dataUrl: cardArt.optional(),
            }),
          )
          .min(1)
          .max(40),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await requireLeagueAdmin();
    await assertCollections(data.cards.map((c) => c.collection));
    const db = await secrets();

    const results = [];
    for (const input of data.cards) {
      const { data: row, error } = await db
        .from("secret_cards")
        .insert({
          name: input.name,
          flavour: input.flavour ?? null,
          collection: input.collection ?? null,
        })
        .select("id")
        .single<{ id: string }>();
      if (error || !row) {
        results.push({ name: input.name, ok: false as const, error: error?.message ?? "insert" });
        continue;
      }
      if (!input.dataUrl) {
        results.push({ name: input.name, ok: true as const, id: row.id, hasArt: false });
        continue;
      }
      try {
        await storeArt(row.id, input.dataUrl);
        results.push({ name: input.name, ok: true as const, id: row.id, hasArt: true });
      } catch (e) {
        // The row survives without art. It is invisible to the pull until the
        // admin retries the upload, which is the safe direction to fail.
        results.push({
          name: input.name,
          ok: false as const,
          error: e instanceof Error ? e.message : "upload failed",
        });
      }
    }
    return { ok: true as const, results };
  });

/** Upload the bytes, then point the row at them. Shared by create and re-upload. */
async function storeArt(cardId: string, dataUrl: string) {
  const { contentType, ext, bytes } = decodeImageDataUrl(dataUrl);
  const path = artPath(cardId, ext);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = await secrets();

  const { data: prev } = await db
    .from("secret_cards")
    .select("art_path")
    .eq("id", cardId)
    .maybeSingle<Pick<SecretCardRow, "art_path">>();

  const { error: upErr } = await supabaseAdmin.storage
    .from("participant-photos")
    .upload(path, bytes, { contentType, upsert: true });
  if (upErr) throw upErr;

  const { error: dbErr } = await db
    .from("secret_cards")
    .update({ art_path: path })
    .eq("id", cardId);
  if (dbErr) throw dbErr;

  // Only bin the old file once the new one is safely referenced — the same
  // ordering uploadEventCardBack uses, so a failure never leaves a card pointing
  // at bytes that are gone.
  if (prev?.art_path && prev.art_path !== path) {
    await supabaseAdmin.storage.from("participant-photos").remove([prev.art_path]);
    forgetSignedPath(prev.art_path);
  }
  return path;
}

export const uploadSecretCardArt = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: zuuid(), dataUrl: cardArt }).parse(d))
  .handler(async ({ data }) => {
    await requireLeagueAdmin();
    const path = await storeArt(data.id, data.dataUrl);
    return { ok: true as const, url: await signPath(path) };
  });

export const updateSecretCard = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        id: zuuid(),
        name: cardName.optional(),
        flavour: cardFlavour.nullable().optional(),
        active: z.boolean().optional(),
        // Same bounds as the CHECK constraint on secret_cards.weight.
        weight: z.number().int().min(0).max(10_000).optional(),
        foil: cardFoil.optional(),
        borderFx: cardBorderFx.optional(),
        collection: cardCollection.nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await requireLeagueAdmin();
    await assertCollections([data.collection]);
    const db = await secrets();
    // Built as a literal rather than spread from `data`: supabase-js rejects an
    // index-signature object in .update(), and a spread would let a caller set id.
    const patch: {
      name?: string;
      flavour?: string | null;
      active?: boolean;
      weight?: number;
      foil?: string;
      border_fx?: string;
      collection?: string | null;
    } = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.flavour !== undefined) patch.flavour = data.flavour;
    if (data.active !== undefined) patch.active = data.active;
    if (data.weight !== undefined) patch.weight = data.weight;
    if (data.foil !== undefined) patch.foil = data.foil;
    if (data.borderFx !== undefined) patch.border_fx = data.borderFx;
    if (data.collection !== undefined) patch.collection = data.collection;
    if (Object.keys(patch).length === 0) return { ok: true as const };

    // .select() after the update so a nonexistent id reports failure rather than
    // succeeding silently against zero rows.
    const { data: row, error } = await db
      .from("secret_cards")
      .update(patch)
      .eq("id", data.id)
      .select("id")
      .maybeSingle<{ id: string }>();
    if (error) throw error;
    if (!row) return { ok: false as const, reason: "not_found" as const };
    return { ok: true as const };
  });

/**
 * Apply one foil and/or border to a whole set in a single write.
 *
 * Twelve WAGs used to mean twelve taps and twelve round trips; a set is the unit
 * an admin actually thinks in. `collection: null` targets the unsorted pile,
 * which is why the filter branches on `is` rather than `eq` — Postgres never
 * matches NULL with `=`.
 */
export const updateSecretCollectionLook = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        collection: cardCollection.nullable(),
        foil: cardFoil.optional(),
        borderFx: cardBorderFx.optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await requireLeagueAdmin();
    await assertCollections([data.collection]);
    const patch: { foil?: string; border_fx?: string } = {};
    if (data.foil !== undefined) patch.foil = data.foil;
    if (data.borderFx !== undefined) patch.border_fx = data.borderFx;
    if (Object.keys(patch).length === 0) return { ok: true as const, updated: 0 };

    const db = await secrets();
    const query = db.from("secret_cards").update(patch);
    const { data: rows, error } =
      data.collection === null
        ? await query.is("collection", null).select("id").returns<{ id: string }[]>()
        : await query.eq("collection", data.collection).select("id").returns<{ id: string }[]>();
    if (error) throw error;
    return { ok: true as const, updated: rows?.length ?? 0 };
  });

/**
 * Remove a card from the set.
 *
 * If anyone has pulled it, it is deactivated instead of deleted — the ledger is
 * the permanent record of what somebody actually found, and the ON DELETE
 * RESTRICT on secret_card_pulls enforces that whatever this code does. This
 * branch exists to turn a foreign-key error into an answer the panel can explain.
 */
export const deleteSecretCard = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: zuuid() }).parse(d))
  .handler(async ({ data }) => {
    await requireLeagueAdmin();
    const db = await secrets();

    const { count } = await db
      .from("secret_card_pulls")
      .select("id", { count: "exact", head: true })
      .eq("secret_card_id", data.id);

    if ((count ?? 0) > 0) {
      const { error } = await db.from("secret_cards").update({ active: false }).eq("id", data.id);
      if (error) throw error;
      return { ok: false as const, reason: "has_pulls" as const, deactivated: true };
    }

    const { data: row } = await db
      .from("secret_cards")
      .select("art_path")
      .eq("id", data.id)
      .maybeSingle<Pick<SecretCardRow, "art_path">>();

    const { error } = await db.from("secret_cards").delete().eq("id", data.id);
    if (error) throw error;

    if (row?.art_path) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.storage.from("participant-photos").remove([row.art_path]);
      forgetSignedPath(row.art_path);
    }
    return { ok: true as const };
  });

/**
 * Hand a specific secret card to a participant.
 *
 * Ledger entry is marked `granted = true`, so it neither collides with today's
 * daily pull nor spends it. If the participant already owns the card this
 * records a duplicate (their vault still shows count +1); if not, they now own
 * it. Uses grant_secret_card so the check runs inside the same transaction as
 * the insert.
 */
export const grantSecretCard = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        participantId: zuuid(),
        cardId: zuuid(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await requireLeagueAdmin();
    const sb = await admin();
    const db = await secrets();

    const { data: event } = await sb
      .from("events")
      .select("id")
      .eq("active", true)
      .order("year", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: result, error } = await db.rpc("grant_secret_card", {
      _participant_id: data.participantId,
      _secret_card_id: data.cardId,
      _event_id: event?.id ?? null,
    });
    if (error) throw new Error(error.message);
    const row = result as { duplicate: boolean } | null;
    return { ok: true as const, duplicate: row?.duplicate ?? false };
  });
