import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "./require-auth.server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

function publicClient() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
  return createClient<Database>(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`) {
          headers.delete("Authorization");
        }
        headers.set("apikey", key);
        return fetch(input, { ...init, headers });
      },
    },
  });
}

// ------- Signed URL cache -------
//
// `createSignedUrl` mints a brand new token every time it is called, so signing
// the same object twice produces two different URL strings for identical bytes.
// That is what made card art re-download constantly: every refetch — and every
// fresh page load — handed the browser a URL it had never seen, so its HTTP
// cache was useless and 30 full-size images came down the wire again.
//
// Signing once per path and handing back the same string until the token is
// close to expiring makes the URL stable, which means the browser cache hits and
// the vault paints from disk. It also keeps React Query's structural sharing
// intact: an unchanged response no longer re-renders every card on screen.
const SIGNED_TTL_S = 8 * 60 * 60;
/** Re-sign well before expiry so a URL handed out now stays valid for hours. */
const SIGNED_REUSE_MS = 6 * 60 * 60_000;
/** Bounded so a long-lived server process can't accumulate every event ever. */
const SIGNED_CACHE_MAX = 600;

const signedCache = new Map<string, { url: string; mintedAt: number }>();
/** In-flight signings, so two requests for one file can't mint two URLs for it. */
const signingNow = new Map<string, Promise<string | null>>();

async function mintSignedUrl(path: string): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: signed } = await supabaseAdmin.storage
    .from("participant-photos")
    .createSignedUrl(path, SIGNED_TTL_S);
  if (!signed?.signedUrl) return null;
  // Map iterates in insertion order, so the first key is the oldest entry.
  if (signedCache.size >= SIGNED_CACHE_MAX) {
    const oldest = signedCache.keys().next().value;
    if (oldest) signedCache.delete(oldest);
  }
  signedCache.delete(path);
  signedCache.set(path, { url: signed.signedUrl, mintedAt: Date.now() });
  return signed.signedUrl;
}

async function signPath(path: string | null): Promise<string | null> {
  if (!path) return null;
  const hit = signedCache.get(path);
  if (hit && Date.now() - hit.mintedAt < SIGNED_REUSE_MS) return hit.url;
  const pending = signingNow.get(path);
  if (pending) return pending;
  const p = mintSignedUrl(path).finally(() => signingNow.delete(path));
  signingNow.set(path, p);
  return p;
}

/** Drop a cached URL when its object is deleted, so nothing hands out a 404. */
function forgetSignedPath(path: string | null | undefined) {
  if (path) signedCache.delete(path);
}

// Return signed URLs for all event participants that have a photo_path.
// Public-readable; the bucket is private, so URLs expire.
export const getEventPhotoUrls = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ eventId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const sb = publicClient();
    const { data: eps } = await sb
      .from("event_participants")
      .select("id, photo_path")
      .eq("event_id", data.eventId);
    const rows = (eps ?? []).filter((r) => !!r.photo_path);
    if (rows.length === 0) return {} as Record<string, string>;
    const out: Record<string, string> = {};
    await Promise.all(
      rows.map(async (r) => {
        const url = await signPath(r.photo_path);
        if (url) out[r.id] = url;
      }),
    );
    return out;
  });

// ------- Player trading cards -------

export type CardSide = "front" | "back";
export type CardUrls = { front: string | null; back: string | null };

const cardSide = z.enum(["front", "back"]);

// Which column each side writes to. `card_path` stays the front so existing rows
// keep working. Built as a literal per side rather than a computed key, because
// supabase-js rejects an index-signature object in .update().
function cardPatch(side: CardSide, value: string | null) {
  return side === "front" ? { card_path: value } : { card_back_path: value };
}

// Decode a base64 data URL into bytes, rejecting anything that isn't an image we accept.
function decodeImageDataUrl(dataUrl: string) {
  const m = dataUrl.match(/^data:(image\/(png|jpeg|jpg|webp));base64,(.+)$/);
  if (!m) throw new Error("Unsupported image format");
  return {
    contentType: m[1],
    ext: m[2] === "jpg" ? "jpeg" : m[2],
    bytes: Uint8Array.from(atob(m[3]), (c) => c.charCodeAt(0)),
  };
}

// Upload one card face and point the matching column at it. Assumes admin is already verified.
async function storeCard(
  eventId: string,
  eventParticipantId: string,
  side: CardSide,
  dataUrl: string,
) {
  const { contentType, ext, bytes } = decodeImageDataUrl(dataUrl);
  const path = `cards/${eventId}/${eventParticipantId}-${side}-${Date.now()}.${ext}`;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error: upErr } = await supabaseAdmin.storage
    .from("participant-photos")
    .upload(path, bytes, { contentType, upsert: true });
  if (upErr) throw upErr;
  const { error: dbErr } = await supabaseAdmin
    .from("event_participants")
    .update(cardPatch(side, path))
    .eq("id", eventParticipantId);
  if (dbErr) throw dbErr;
  return { url: await signPath(path), path };
}

// Signed URLs for both faces of every uploaded player card, keyed by event_participant id.
//
// The event's universal back is resolved here rather than at each call site, so
// every surface that already reads `urls.back` — the vault detail page, the pack
// reveal — picks it up without changing. A player's own card_back_path still wins.
export const getEventCardUrls = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ eventId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const sb = publicClient();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // `events` is service-role only (public reads go through events_public), so
    // the universal back has to come off the admin client.
    const [{ data: eps }, { data: event }] = await Promise.all([
      sb
        .from("event_participants")
        .select("id, card_path, card_back_path")
        .eq("event_id", data.eventId),
      supabaseAdmin.from("events").select("card_back_path").eq("id", data.eventId).maybeSingle(),
    ]);
    const universalPath = event?.card_back_path ?? null;
    // With a universal back set, every participant has a back — including those
    // with no art of their own yet — so they can't be filtered out here.
    const rows = (eps ?? []).filter((r) => r.card_path || r.card_back_path || universalPath);
    if (rows.length === 0) return {} as Record<string, CardUrls>;
    // Signed once and shared, rather than re-signing the same object per player.
    const universalUrl = await signPath(universalPath);
    const out: Record<string, CardUrls> = {};
    await Promise.all(
      rows.map(async (r) => {
        const [front, ownBack] = await Promise.all([
          signPath(r.card_path),
          signPath(r.card_back_path),
        ]);
        out[r.id] = { front, back: ownBack ?? universalUrl };
      }),
    );
    return out;
  });

// The universal back on its own, for the admin panel's preview.
export const getEventCardBack = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ eventId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: event } = await supabaseAdmin
      .from("events")
      .select("card_back_path")
      .eq("id", data.eventId)
      .maybeSingle();
    if (!event?.card_back_path) return { url: null as string | null };
    return { url: await signPath(event.card_back_path) };
  });

// Upload one image and make it the back of every card in the event.
export const uploadEventCardBack = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        eventId: z.string().uuid(),
        dataUrl: z.string().min(32).max(12_000_000),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await requireAdmin(data.eventId);
    const { contentType, ext, bytes } = decodeImageDataUrl(data.dataUrl);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: prev } = await supabaseAdmin
      .from("events")
      .select("card_back_path")
      .eq("id", data.eventId)
      .maybeSingle();
    // Timestamped filename so the signed URL changes and nobody keeps seeing a
    // cached copy of the old back after a re-upload.
    const path = `cards/${data.eventId}/universal-back-${Date.now()}.${ext}`;
    const { error: upErr } = await supabaseAdmin.storage
      .from("participant-photos")
      .upload(path, bytes, { contentType, upsert: true });
    if (upErr) throw upErr;
    const { error: dbErr } = await supabaseAdmin
      .from("events")
      .update({ card_back_path: path })
      .eq("id", data.eventId);
    if (dbErr) throw dbErr;
    // Only bin the old file once the new one is safely referenced.
    if (prev?.card_back_path && prev.card_back_path !== path) {
      await supabaseAdmin.storage.from("participant-photos").remove([prev.card_back_path]);
      forgetSignedPath(prev.card_back_path);
    }
    return { ok: true, url: await signPath(path), path };
  });

export const deleteEventCardBack = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ eventId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin(data.eventId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: event } = await supabaseAdmin
      .from("events")
      .select("card_back_path")
      .eq("id", data.eventId)
      .maybeSingle();
    if (event?.card_back_path) {
      await supabaseAdmin.storage.from("participant-photos").remove([event.card_back_path]);
      forgetSignedPath(event.card_back_path);
    }
    await supabaseAdmin.from("events").update({ card_back_path: null }).eq("id", data.eventId);
    return { ok: true };
  });

export const uploadParticipantCard = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        eventId: z.string().uuid(),
        eventParticipantId: z.string().uuid(),
        side: cardSide.default("front"),
        dataUrl: z.string().min(32).max(12_000_000),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await requireAdmin(data.eventId);
    const res = await storeCard(data.eventId, data.eventParticipantId, data.side, data.dataUrl);
    return { ok: true, ...res };
  });

// Upload many card faces behind a single admin check. Each item reports its own outcome so
// one bad file in a batch of 26 doesn't discard the rest.
export const uploadParticipantCardsBulk = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        eventId: z.string().uuid(),
        items: z
          .array(
            z.object({
              eventParticipantId: z.string().uuid(),
              side: cardSide,
              dataUrl: z.string().min(32).max(12_000_000),
            }),
          )
          .min(1)
          .max(40),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await requireAdmin(data.eventId);
    const results: {
      eventParticipantId: string;
      side: CardSide;
      ok: boolean;
      error?: string;
    }[] = [];
    for (const item of data.items) {
      try {
        await storeCard(data.eventId, item.eventParticipantId, item.side, item.dataUrl);
        results.push({ eventParticipantId: item.eventParticipantId, side: item.side, ok: true });
      } catch (e) {
        results.push({
          eventParticipantId: item.eventParticipantId,
          side: item.side,
          ok: false,
          error: e instanceof Error ? e.message : "Upload failed",
        });
      }
    }
    return { ok: results.every((r) => r.ok), results };
  });

export const deleteParticipantCard = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        eventId: z.string().uuid(),
        eventParticipantId: z.string().uuid(),
        side: cardSide.default("front"),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await requireAdmin(data.eventId);
    const side: CardSide = data.side;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("event_participants")
      .select("card_path, card_back_path")
      .eq("id", data.eventParticipantId)
      .maybeSingle();
    // Read the column explicitly rather than dynamically indexing the row.
    const existing = (side === "front" ? row?.card_path : row?.card_back_path) ?? null;
    if (existing) {
      await supabaseAdmin.storage.from("participant-photos").remove([existing]);
      forgetSignedPath(existing);
    }
    await supabaseAdmin
      .from("event_participants")
      .update(cardPatch(side, null))
      .eq("id", data.eventParticipantId);
    return { ok: true };
  });

export const uploadParticipantPhoto = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        eventId: z.string().uuid(),
        eventParticipantId: z.string().uuid(),
        // data URL (image/jpeg or image/png)
        dataUrl: z.string().min(32).max(6_000_000),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await requireAdmin(data.eventId);
    const m = data.dataUrl.match(/^data:(image\/(png|jpeg|jpg|webp));base64,(.+)$/);
    if (!m) throw new Error("Unsupported image format");
    const contentType = m[1];
    const ext = m[2] === "jpg" ? "jpeg" : m[2];
    const bytes = Uint8Array.from(atob(m[3]), (c) => c.charCodeAt(0));
    const path = `${data.eventId}/${data.eventParticipantId}-${Date.now()}.${ext}`;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: upErr } = await supabaseAdmin.storage
      .from("participant-photos")
      .upload(path, bytes, { contentType, upsert: true });
    if (upErr) throw upErr;
    const { error: dbErr } = await supabaseAdmin
      .from("event_participants")
      .update({ photo_path: path })
      .eq("id", data.eventParticipantId);
    if (dbErr) throw dbErr;
    return { ok: true, url: await signPath(path), path };
  });

// ------- Archive / recap -------
function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export const archiveEvent = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ eventId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin(data.eventId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [event, eps, stations, runs, splits, penalties, drafts] = await Promise.all([
      supabaseAdmin.from("events").select("*").eq("id", data.eventId).maybeSingle(),
      supabaseAdmin
        .from("event_participants")
        .select("*, participant:participants(*)")
        .eq("event_id", data.eventId),
      supabaseAdmin.from("stations").select("*").eq("event_id", data.eventId),
      supabaseAdmin
        .from("runs")
        .select(
          "id, event_id, participant_id, attempt_number, started_at, finished_at, raw_time_ms, paused_duration_ms, penalty_ms, official_time_ms, status, notes, is_official, created_at, updated_at",
        )
        .eq("event_id", data.eventId),
      supabaseAdmin
        .from("splits")
        .select(
          "id, run_id, station_id, recorded_at, cumulative_time_ms, segment_time_ms, entry_method, corrected, correction_reason, created_at, updated_at",
        ),
      supabaseAdmin
        .from("penalties")
        .select("id, run_id, station_id, penalty_ms, reason, notes, created_at"),
      supabaseAdmin
        .from("draft_selections")
        .select("id, event_id, participant_id, selection_order, draft_position, selected_at")
        .eq("event_id", data.eventId),
    ]);
    if (!event.data) throw new Error("Event not found");
    const runIds = new Set((runs.data ?? []).map((r) => r.id));
    const snapshot = {
      event: event.data,
      participants: eps.data ?? [],
      stations: stations.data ?? [],
      runs: runs.data ?? [],
      splits: (splits.data ?? []).filter((s) => runIds.has(s.run_id)),
      penalties: (penalties.data ?? []).filter((p) => runIds.has(p.run_id)),
      drafts: drafts.data ?? [],
      archivedAt: new Date().toISOString(),
    };
    const base = slugify(`${event.data.name}-${event.data.year ?? new Date().getFullYear()}`);
    let slug = base;
    for (let i = 2; i < 20; i++) {
      const { data: existing } = await supabaseAdmin
        .from("event_archive_snapshots")
        .select("id")
        .eq("slug", slug)
        .maybeSingle();
      if (!existing) break;
      slug = `${base}-${i}`;
    }
    const { error } = await supabaseAdmin.from("event_archive_snapshots").insert({
      event_id: data.eventId,
      slug,
      event_name: event.data.name,
      event_year: event.data.year ?? null,
      snapshot: snapshot as never,
    });
    if (error) throw error;
    return { ok: true, slug };
  });

export const listArchives = createServerFn({ method: "GET" }).handler(async () => {
  const sb = publicClient();
  const { data } = await sb
    .from("event_archive_snapshots")
    .select("id, slug, event_name, event_year, created_at")
    .order("created_at", { ascending: false });
  return data ?? [];
});

export const getArchivedRecap = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ slug: z.string().min(1).max(80) }).parse(d))
  .handler(async ({ data }) => {
    const sb = publicClient();
    const { data: row } = await sb
      .from("event_archive_snapshots")
      .select("*")
      .eq("slug", data.slug)
      .maybeSingle();
    return row;
  });
