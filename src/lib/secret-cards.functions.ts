import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader, setResponseHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { optionalMember, requireAdmin, requireMember } from "./require-auth.server";
import { decodeImageDataUrl, forgetSignedPath, signPath } from "./media.functions";
import type {
  PullSecretCardResult,
  SecretCardRow,
  SecretPullRow,
  SecretPullStatusResult,
} from "./secret-cards-db.server";
import type { SecretCardView } from "./secret-cards";

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
async function requireLeagueAdmin(): Promise<string> {
  // Header first, so an unauthenticated hit costs no database round trip and the
  // guard really is the first thing that happens.
  if (!getRequestHeader("x-admin-token")) throw new Error("Admin PIN required");
  const sb = await admin();
  const { data: event } = await sb
    .from("events")
    .select("id")
    .eq("active", true)
    .order("year", { ascending: false })
    .limit(1)
    .maybeSingle();
  // The same message as a missing token, deliberately: the failure must not
  // distinguish "wrong PIN" from "nothing to be admin of".
  if (!event) throw new Error("Admin PIN required");
  await requireAdmin(event.id);
  return event.id;
}

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

function toView(row: SecretCardRow, artUrl: string | null, backUrl: string | null): SecretCardView {
  return {
    id: row.id,
    name: row.name,
    flavour: row.flavour,
    foil: row.foil,
    artUrl,
    backUrl,
  };
}

async function signCard(row: SecretCardRow) {
  const [artUrl, backUrl] = await Promise.all([signPath(row.art_path), signPath(row.back_path)]);
  return toView(row, artUrl, backUrl);
}

// ------- Member-facing -------

/**
 * Today's secret card. Takes no input at all: the member comes from the verified
 * token and the card is chosen by Postgres.
 *
 * Calling twice in one league day returns the same card with `fresh: false`
 * rather than failing, so a double-tap or a retried request resumes the reveal.
 */
export const pullSecretCard = createServerFn({ method: "POST" }).handler(async () => {
  const me = await requireMember();
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
    _participant_id: me,
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
    card: await signCard(card),
  };
});

/**
 * Whether there is a card waiting today. A pure read — opening the pack screen
 * must never spend the drop.
 *
 * Answers for an unclaimed visitor too, with everything false, so a guest can
 * reach the pack screen without this throwing at them.
 */
export const getSecretStatus = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  const me = optionalMember();
  if (!me) {
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
  const { data, error } = await db.rpc("secret_pull_status", { _participant_id: me });
  if (error) throw new Error(error.message);
  const status = data as SecretPullStatusResult;
  return { claimed: true as const, ...status };
});

/**
 * The secrets this member has pulled, and only those.
 *
 * Deactivated cards are deliberately not filtered out: you pulled it, you keep
 * it. Retiring a card removes it from future pulls, never from somebody's vault.
 */
export const getMySecrets = createServerFn({ method: "GET" }).handler(async () => {
  const me = await requireMember();
  noStore();
  const db = await secrets();

  const { data: pulls, error } = await db
    .from("secret_card_pulls")
    .select("secret_card_id, pulled_on, is_duplicate")
    .eq("participant_id", me)
    .order("pulled_on", { ascending: false })
    .returns<Pick<SecretPullRow, "secret_card_id" | "pulled_on" | "is_duplicate">[]>();
  if (error) throw error;

  // Ownership comes from the non-duplicate rows; duplicates only bump the count.
  const owned = new Map<string, { firstPulledOn: string; count: number }>();
  for (const p of pulls ?? []) {
    const seen = owned.get(p.secret_card_id);
    if (seen) {
      seen.count += 1;
      // Ordered newest first, so every later row is older than the one held.
      seen.firstPulledOn = p.pulled_on;
    } else {
      owned.set(p.secret_card_id, { firstPulledOn: p.pulled_on, count: 1 });
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
    // secret_card_pulls_owned_once makes at most one non-duplicate row per person
    // per card, so counting rows here IS counting people.
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
      ...(await signCard(row)),
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
    // never used one, and since an unclaimed player has no identity their pulls
    // are never recorded — so `exhausted` below could never be reached.
    sb
      .from("member_codes")
      .select("participant_id", { count: "exact", head: true })
      .not("claimed_at", "is", null),
  ]);

  const owners = new Map<string, number>();
  for (const p of pulls ?? [])
    owners.set(p.secret_card_id, (owners.get(p.secret_card_id) ?? 0) + 1);

  const claimed = claimedCount ?? 0;
  const cards = await Promise.all(
    (rows ?? []).map(async (row) => ({
      id: row.id,
      name: row.name,
      flavour: row.flavour,
      foil: row.foil,
      active: row.active,
      hasArt: !!row.art_path,
      artUrl: await signPath(row.art_path),
      ownerCount: owners.get(row.id) ?? 0,
    })),
  );

  const pullable = cards.filter((c) => c.active && c.hasArt);
  return {
    cards,
    claimedMembers: claimed,
    // Everyone who could pull has pulled everything there is. The panel says so,
    // because otherwise the admin has no way to know the daily drop has gone
    // quiet and turned into nothing but duplicates.
    exhausted: claimed > 0 && pullable.length > 0 && pullable.every((c) => c.ownerCount >= claimed),
  };
});

const cardName = z.string().trim().min(1).max(60);
const cardFlavour = z.string().trim().max(240);
// Same cap as every other upload path: base64 expands by 4/3, so this is the
// 8.8 MB the client-side check enforces before encoding.
const cardArt = z.string().min(32).max(12_000_000);

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
    const db = await secrets();

    const results = [];
    for (const input of data.cards) {
      const { data: row, error } = await db
        .from("secret_cards")
        .insert({ name: input.name, flavour: input.flavour ?? null })
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
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid(), dataUrl: cardArt }).parse(d))
  .handler(async ({ data }) => {
    await requireLeagueAdmin();
    const path = await storeArt(data.id, data.dataUrl);
    return { ok: true as const, url: await signPath(path) };
  });

export const updateSecretCard = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        name: cardName.optional(),
        flavour: cardFlavour.nullable().optional(),
        active: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await requireLeagueAdmin();
    const db = await secrets();
    // Built as a literal rather than spread from `data`: supabase-js rejects an
    // index-signature object in .update(), and a spread would let a caller set id.
    const patch: { name?: string; flavour?: string | null; active?: boolean } = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.flavour !== undefined) patch.flavour = data.flavour;
    if (data.active !== undefined) patch.active = data.active;
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
 * Remove a card from the set.
 *
 * If anyone has pulled it, it is deactivated instead of deleted — the ledger is
 * the permanent record of what somebody actually found, and the ON DELETE
 * RESTRICT on secret_card_pulls enforces that whatever this code does. This
 * branch exists to turn a foreign-key error into an answer the panel can explain.
 */
export const deleteSecretCard = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
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
