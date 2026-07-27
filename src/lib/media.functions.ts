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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const out: Record<string, string> = {};
    await Promise.all(
      rows.map(async (r) => {
        const { data: signed } = await supabaseAdmin.storage
          .from("participant-photos")
          .createSignedUrl(r.photo_path as string, 60 * 60);
        if (signed?.signedUrl) out[r.id] = signed.signedUrl;
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
  const { data: signed } = await supabaseAdmin.storage
    .from("participant-photos")
    .createSignedUrl(path, 60 * 60);
  return { url: signed?.signedUrl ?? null, path };
}

// Signed URLs for both faces of every uploaded player card, keyed by event_participant id.
export const getEventCardUrls = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ eventId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const sb = publicClient();
    const { data: eps } = await sb
      .from("event_participants")
      .select("id, card_path, card_back_path")
      .eq("event_id", data.eventId);
    const rows = (eps ?? []).filter((r) => r.card_path || r.card_back_path);
    if (rows.length === 0) return {} as Record<string, CardUrls>;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sign = async (path: string | null) => {
      if (!path) return null;
      const { data: signed } = await supabaseAdmin.storage
        .from("participant-photos")
        .createSignedUrl(path, 60 * 60);
      return signed?.signedUrl ?? null;
    };
    const out: Record<string, CardUrls> = {};
    await Promise.all(
      rows.map(async (r) => {
        const [front, back] = await Promise.all([sign(r.card_path), sign(r.card_back_path)]);
        out[r.id] = { front, back };
      }),
    );
    return out;
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
    const { data: signed } = await supabaseAdmin.storage
      .from("participant-photos")
      .createSignedUrl(path, 60 * 60);
    return { ok: true, url: signed?.signedUrl ?? null, path };
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
