// The server side of images: signing, uploading, the storage bucket. The shapes
// these hand back — and the pure helpers that read them — live in ./media, so a
// component that only wants a URL out of an ImageUrlSet never has to import a
// module that pulls in the admin guard.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "./require-auth.server";
import {
  VARIANT_WIDTHS,
  type CardSide,
  type CardUrls,
  type ImageUrlSet,
  type SizedPhotoUrls,
} from "./media";
import type { Database } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { publicClient } from "./public-client.server";
import { uuid as zuuid } from "./zod-uuid";

// ------- Signed URL cache -------

const SIGNED_TTL_S = 8 * 60 * 60;
/** Re-sign well before expiry so a URL handed out now stays valid for hours. */
const SIGNED_REUSE_MS = 6 * 60 * 60_000;
/** Bounded so a long-lived server process can't accumulate every event ever. */
const SIGNED_CACHE_MAX = 600;

const signedCache = new Map<string, { url: string; mintedAt: number }>();
const signingNow = new Map<string, Promise<string | null>>();

/** Lower quality where the image is small enough that nobody can tell. */
const QUALITY_FOR_WIDTH: Record<number, number> = {
  [320]: 58,
  [800]: 68,
  [1200]: 74,
};

function cacheKey(path: string, width?: number) {
  return width ? `${path}@${width}` : path;
}

async function mintSignedUrl(path: string, width?: number): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const key = cacheKey(path, width);
  const { data: signed } = await supabaseAdmin.storage.from("participant-photos").createSignedUrl(
    path,
    SIGNED_TTL_S,
    width
      ? {
          transform: {
            width,
            quality: QUALITY_FOR_WIDTH[width] ?? 72,
            resize: "contain",
          },
        }
      : undefined,
  );
  if (!signed?.signedUrl) return null;
  if (signedCache.size >= SIGNED_CACHE_MAX) {
    const oldest = signedCache.keys().next().value;
    if (oldest) signedCache.delete(oldest);
  }
  signedCache.delete(key);
  signedCache.set(key, { url: signed.signedUrl, mintedAt: Date.now() });
  return signed.signedUrl;
}

export async function signPath(path: string | null, width?: number): Promise<string | null> {
  if (!path) return null;
  const key = cacheKey(path, width);
  const hit = signedCache.get(key);
  if (hit && Date.now() - hit.mintedAt < SIGNED_REUSE_MS) return hit.url;
  const pending = signingNow.get(key);
  if (pending) return pending;
  const p = mintSignedUrl(path, width).finally(() => signingNow.delete(key));
  signingNow.set(key, p);
  return p;
}

export function forgetSignedPath(path: string | null | undefined) {
  if (!path) return;
  signedCache.delete(path);
  for (const w of Object.values(VARIANT_WIDTHS)) signedCache.delete(cacheKey(path, w));
}

async function signSet(paths: {
  thumb: string | null;
  medium: string | null;
  large: string | null;
}): Promise<ImageUrlSet> {
  // A missing variant path is the common case — nothing was ever backfilled —
  // so fall back to a resize of the original rather than to the original itself.
  const [thumb, medium, large] = await Promise.all([
    paths.thumb ? signPath(paths.thumb) : signPath(paths.large, VARIANT_WIDTHS.thumb),
    paths.medium ? signPath(paths.medium) : signPath(paths.large, VARIANT_WIDTHS.medium),
    // Never hand back the untouched original: it is the multi-megabyte PNG.
    paths.medium ? signPath(paths.large) : signPath(paths.large, VARIANT_WIDTHS.large),
  ]);
  return { thumb, medium, large };
}

// Return signed URLs for all event participants that have a photo_path.
export const getEventPhotoUrls = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ eventId: zuuid() }).parse(d))
  .handler(async ({ data }) => {
    const sb = publicClient();
    const { data: eps } = await sb
      .from("event_participants")
      .select("id, photo_path, photo_path_thumb, photo_path_medium")
      .eq("event_id", data.eventId);
    const rows = (eps ?? []).filter((r) => !!r.photo_path);
    if (rows.length === 0) return {} as SizedPhotoUrls;
    const out: SizedPhotoUrls = {};
    await Promise.all(
      rows.map(async (r) => {
        const set = await signSet({
          thumb: r.photo_path_thumb,
          medium: r.photo_path_medium,
          large: r.photo_path,
        });
        if (set.large) out[r.id] = set;
      }),
    );
    return out;
  });

// ------- Player trading cards -------

const cardSide = z.enum(["front", "back"]);

// Base64 expands by 4/3, so this is the 8.8 MB the client-side check enforces
// before encoding — the same cap secret-cards.functions.ts puts on card art. An
// unbounded string here is a request body the handler decodes into memory and
// then hands to storage, so the ceiling is the point.
const dataUrl = z.string().min(32).max(12_000_000);
const sizedDataUrls = z.object({ thumb: dataUrl, medium: dataUrl, large: dataUrl });

type SizedCardPaths = {
  thumb: string | null;
  medium: string | null;
  large: string | null;
};

type CardPathColumn =
  | "card_path"
  | "card_path_thumb"
  | "card_path_medium"
  | "card_back_path"
  | "card_back_path_thumb"
  | "card_back_path_medium"
  | "photo_path"
  | "photo_path_thumb"
  | "photo_path_medium";

function cardPatch(side: CardSide, value: SizedCardPaths | null) {
  if (side === "front") {
    return {
      card_path: value?.large ?? null,
      card_path_thumb: value?.thumb ?? null,
      card_path_medium: value?.medium ?? null,
    };
  }
  return {
    card_back_path: value?.large ?? null,
    card_back_path_thumb: value?.thumb ?? null,
    card_back_path_medium: value?.medium ?? null,
  };
}

export type SizedDataUrls = {
  thumb: string;
  medium: string;
  large: string;
};

export function decodeImageDataUrl(dataUrl: string) {
  const m = dataUrl.match(/^data:(image\/(png|jpeg|jpg|webp));base64,(.+)$/);
  if (!m) throw new Error("Unsupported image format");
  return {
    contentType: m[1],
    ext: m[2] === "jpg" ? "jpeg" : m[2],
    bytes: Uint8Array.from(atob(m[3]), (c) => c.charCodeAt(0)),
  };
}

async function uploadSized(
  supabaseAdmin: SupabaseClient<Database>,
  basePath: string,
  dataUrls: SizedDataUrls,
): Promise<SizedCardPaths> {
  const sizes: (keyof SizedDataUrls)[] = ["large", "medium", "thumb"];
  const suffixes: Record<keyof SizedDataUrls, string> = {
    large: "large",
    medium: "medium",
    thumb: "thumb",
  };
  const paths: Partial<Record<keyof SizedDataUrls, string>> = {};

  await Promise.all(
    sizes.map(async (size) => {
      const { contentType, ext, bytes } = decodeImageDataUrl(dataUrls[size]);
      const path = `${basePath}-${suffixes[size]}.${ext}`;
      const { error } = await supabaseAdmin.storage
        .from("participant-photos")
        .upload(path, bytes, { contentType, upsert: true });
      if (error) throw error;
      paths[size] = path;
    }),
  );

  return {
    large: paths.large ?? null,
    medium: paths.medium ?? null,
    thumb: paths.thumb ?? null,
  };
}

/**
 * Prove roster rows belong to the event the caller's token authorizes.
 *
 * `requireAdmin(eventId)` proves admin of event A, and every participant id
 * below arrives in the payload — so without this an admin for A could write
 * over a row in event B. Checked before anything reaches the bucket, so a
 * rejected call leaves no orphan objects behind.
 */
async function assertOnRoster(
  supabaseAdmin: SupabaseClient<Database>,
  eventId: string,
  eventParticipantIds: readonly string[],
) {
  const wanted = [...new Set(eventParticipantIds)];
  if (wanted.length === 0) return;
  const { data, error } = await supabaseAdmin
    .from("event_participants")
    .select("id")
    .eq("event_id", eventId)
    .in("id", wanted);
  if (error) throw error;
  if ((data ?? []).length !== wanted.length) {
    throw new Error("Participant does not belong to this event");
  }
}

async function storeCard(
  eventId: string,
  eventParticipantId: string,
  side: CardSide,
  dataUrls: SizedDataUrls,
) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await assertOnRoster(supabaseAdmin, eventId, [eventParticipantId]);
  const basePath = `cards/${eventId}/${eventParticipantId}-${side}-${Date.now()}`;
  const paths = await uploadSized(supabaseAdmin, basePath, dataUrls);

  const { error: dbErr } = await supabaseAdmin
    .from("event_participants")
    .update(cardPatch(side, paths))
    .eq("id", eventParticipantId)
    .eq("event_id", eventId);
  if (dbErr) throw dbErr;

  return { urls: await signSet(paths), paths };
}

export const getEventCardUrls = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ eventId: zuuid() }).parse(d))
  .handler(async ({ data }) => {
    const sb = publicClient();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: eps }, { data: event }] = await Promise.all([
      sb
        .from("event_participants")
        .select(
          "id, card_path, card_path_thumb, card_path_medium, card_back_path, card_back_path_thumb, card_back_path_medium",
        )
        .eq("event_id", data.eventId),
      supabaseAdmin
        .from("events")
        .select("card_back_path, card_back_path_thumb, card_back_path_medium")
        .eq("id", data.eventId)
        .maybeSingle(),
    ]);

    const universalPaths = {
      thumb: event?.card_back_path_thumb ?? null,
      medium: event?.card_back_path_medium ?? null,
      large: event?.card_back_path ?? null,
    };
    const universalSet = await signSet(universalPaths);

    const rows = (eps ?? []).filter((r) => r.card_path || r.card_back_path || universalPaths.large);
    if (rows.length === 0) return {} as Record<string, CardUrls>;

    const out: Record<string, CardUrls> = {};
    await Promise.all(
      rows.map(async (r) => {
        const [front, ownBack] = await Promise.all([
          signSet({
            thumb: r.card_path_thumb,
            medium: r.card_path_medium,
            large: r.card_path,
          }),
          signSet({
            thumb: r.card_back_path_thumb,
            medium: r.card_back_path_medium,
            large: r.card_back_path,
          }),
        ]);
        out[r.id] = {
          front: front.large ? front : null,
          back: (ownBack.large ? ownBack : universalSet).large
            ? ownBack.large
              ? ownBack
              : universalSet
            : null,
        };
      }),
    );
    return out;
  });

export const getEventCardBack = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ eventId: zuuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: event } = await supabaseAdmin
      .from("events")
      .select("card_back_path, card_back_path_thumb, card_back_path_medium")
      .eq("id", data.eventId)
      .maybeSingle();
    if (!event?.card_back_path)
      return { urls: { thumb: null, medium: null, large: null } as ImageUrlSet };
    return {
      urls: await signSet({
        thumb: event.card_back_path_thumb,
        medium: event.card_back_path_medium,
        large: event.card_back_path,
      }),
    };
  });

export const uploadEventCardBack = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        eventId: zuuid(),
        dataUrls: sizedDataUrls,
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await requireAdmin(data.eventId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: prev } = await supabaseAdmin
      .from("events")
      .select("card_back_path, card_back_path_thumb, card_back_path_medium")
      .eq("id", data.eventId)
      .maybeSingle();

    const basePath = `cards/${data.eventId}/universal-back-${Date.now()}`;
    const paths = await uploadSized(supabaseAdmin, basePath, data.dataUrls);

    const { error: dbErr } = await supabaseAdmin
      .from("events")
      .update({
        card_back_path: paths.large,
        card_back_path_thumb: paths.thumb,
        card_back_path_medium: paths.medium,
      })
      .eq("id", data.eventId);
    if (dbErr) throw dbErr;

    await removePaths(supabaseAdmin, [
      prev?.card_back_path,
      prev?.card_back_path_thumb,
      prev?.card_back_path_medium,
    ]);

    return { ok: true, urls: await signSet(paths), paths };
  });

export const deleteEventCardBack = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ eventId: zuuid() }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin(data.eventId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: event } = await supabaseAdmin
      .from("events")
      .select("card_back_path, card_back_path_thumb, card_back_path_medium")
      .eq("id", data.eventId)
      .maybeSingle();
    await removePaths(supabaseAdmin, [
      event?.card_back_path,
      event?.card_back_path_thumb,
      event?.card_back_path_medium,
    ]);
    await supabaseAdmin
      .from("events")
      .update({
        card_back_path: null,
        card_back_path_thumb: null,
        card_back_path_medium: null,
      })
      .eq("id", data.eventId);
    return { ok: true };
  });

export const uploadParticipantCard = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        eventId: zuuid(),
        eventParticipantId: zuuid(),
        side: cardSide.default("front"),
        dataUrls: sizedDataUrls,
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await requireAdmin(data.eventId);
    const res = await storeCard(data.eventId, data.eventParticipantId, data.side, data.dataUrls);
    return { ok: true, ...res };
  });

export const uploadParticipantCardsBulk = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        eventId: zuuid(),
        items: z
          .array(
            z.object({
              eventParticipantId: zuuid(),
              side: cardSide,
              dataUrls: sizedDataUrls,
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
        await storeCard(data.eventId, item.eventParticipantId, item.side, item.dataUrls);
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

async function removePaths(
  supabaseAdmin: SupabaseClient<Database>,
  paths: (string | null | undefined)[],
) {
  const toRemove = paths.filter((p): p is string => !!p);
  if (toRemove.length === 0) return;
  await supabaseAdmin.storage.from("participant-photos").remove(toRemove);
  for (const p of toRemove) forgetSignedPath(p);
}

export const deleteParticipantCard = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        eventId: zuuid(),
        eventParticipantId: zuuid(),
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
      .select(
        "card_path, card_path_thumb, card_path_medium, card_back_path, card_back_path_thumb, card_back_path_medium",
      )
      .eq("id", data.eventParticipantId)
      .eq("event_id", data.eventId)
      .maybeSingle();
    // Absent means the id names somebody else's event, not an empty card: the
    // roster row itself is what the filter above did or did not match.
    if (!row) throw new Error("Participant does not belong to this event");

    const existing = {
      large: side === "front" ? row.card_path : row.card_back_path,
      thumb: side === "front" ? row.card_path_thumb : row.card_back_path_thumb,
      medium: side === "front" ? row.card_path_medium : row.card_back_path_medium,
    };

    await removePaths(supabaseAdmin, [existing.large, existing.thumb, existing.medium]);
    await supabaseAdmin
      .from("event_participants")
      .update(cardPatch(side, null))
      .eq("id", data.eventParticipantId)
      .eq("event_id", data.eventId);
    return { ok: true };
  });

export const uploadParticipantPhoto = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        eventId: zuuid(),
        eventParticipantId: zuuid(),
        dataUrls: sizedDataUrls,
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await requireAdmin(data.eventId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await assertOnRoster(supabaseAdmin, data.eventId, [data.eventParticipantId]);

    const basePath = `${data.eventId}/${data.eventParticipantId}-${Date.now()}`;
    const paths = await uploadSized(supabaseAdmin, basePath, data.dataUrls);

    const { error: dbErr } = await supabaseAdmin
      .from("event_participants")
      .update({
        photo_path: paths.large,
        photo_path_thumb: paths.thumb,
        photo_path_medium: paths.medium,
      })
      .eq("id", data.eventParticipantId)
      .eq("event_id", data.eventId);
    if (dbErr) throw dbErr;
    return { ok: true, urls: await signSet(paths), paths };
  });

// ------- Backfill existing images -------

export const getImagePathsNeedingVariants = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ eventId: zuuid() }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin(data.eventId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: eps }, { data: event }] = await Promise.all([
      supabaseAdmin
        .from("event_participants")
        .select(
          "id, photo_path, photo_path_thumb, card_path, card_path_thumb, card_back_path, card_back_path_thumb",
        )
        .eq("event_id", data.eventId),
      supabaseAdmin
        .from("events")
        .select("id, card_back_path, card_back_path_thumb")
        .eq("id", data.eventId)
        .maybeSingle(),
    ]);

    const needs: { id: string; kind: string; path: string }[] = [];
    for (const ep of eps ?? []) {
      if (ep.photo_path && !ep.photo_path_thumb) {
        needs.push({ id: ep.id, kind: "photo", path: ep.photo_path });
      }
      if (ep.card_path && !ep.card_path_thumb) {
        needs.push({ id: ep.id, kind: "card_front", path: ep.card_path });
      }
      if (ep.card_back_path && !ep.card_back_path_thumb) {
        needs.push({ id: ep.id, kind: "card_back", path: ep.card_back_path });
      }
    }
    if (event?.card_back_path && !event.card_back_path_thumb) {
      needs.push({ id: event.id, kind: "universal_back", path: event.card_back_path });
    }
    // Sign each original so the admin's browser can fetch, re-encode, and
    // send variant data URLs back through writeImageVariants.
    const signed = await Promise.all(
      needs.map(async (n) => ({ ...n, url: await signPath(n.path) })),
    );
    return { needs: signed.filter((n): n is (typeof signed)[number] & { url: string } => !!n.url) };
  });

export const writeImageVariants = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        eventId: zuuid(),
        // Each entry carries three images, so an uncapped array is an uncapped
        // request body. Thirty is more than a backfill pass over this roster
        // ever needs, and well under the 40 the bulk card upload allows.
        updates: z
          .array(
            z.object({
              id: zuuid(),
              kind: z.enum(["photo", "card_front", "card_back", "universal_back"]),
              dataUrls: sizedDataUrls,
            }),
          )
          .max(30),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await requireAdmin(data.eventId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // The whole batch is authorized before the first byte is uploaded. A
    // universal back is the event's own row, so its id must be this event; every
    // other id must name a row on this event's roster.
    for (const u of data.updates) {
      if (u.kind === "universal_back" && u.id !== data.eventId) {
        throw new Error("Card back does not belong to this event");
      }
    }
    await assertOnRoster(
      supabaseAdmin,
      data.eventId,
      data.updates.filter((u) => u.kind !== "universal_back").map((u) => u.id),
    );

    for (const u of data.updates) {
      const basePath =
        u.kind === "universal_back"
          ? `cards/${data.eventId}/universal-back-backfill-${Date.now()}-${u.id}`
          : u.kind === "photo"
            ? `${data.eventId}/${u.id}-backfill-${Date.now()}`
            : `cards/${data.eventId}/${u.id}-${u.kind === "card_front" ? "front" : "back"}-backfill-${Date.now()}`;
      const paths = await uploadSized(supabaseAdmin, basePath, u.dataUrls);
      const patchPaths = {
        large: paths.large ?? "",
        medium: paths.medium ?? "",
        thumb: paths.thumb ?? "",
      };
      if (u.kind === "universal_back") {
        const { error } = await supabaseAdmin
          .from("events")
          .update({
            card_back_path: patchPaths.large,
            card_back_path_thumb: patchPaths.thumb,
            card_back_path_medium: patchPaths.medium,
          })
          .eq("id", data.eventId);
        if (error) throw error;
      } else {
        const patch: Partial<Record<CardPathColumn, string | null>> = {};
        if (u.kind === "photo") {
          patch.photo_path = patchPaths.large;
          patch.photo_path_thumb = patchPaths.thumb;
          patch.photo_path_medium = patchPaths.medium;
        } else if (u.kind === "card_front") {
          patch.card_path = patchPaths.large;
          patch.card_path_thumb = patchPaths.thumb;
          patch.card_path_medium = patchPaths.medium;
        } else if (u.kind === "card_back") {
          patch.card_back_path = patchPaths.large;
          patch.card_back_path_thumb = patchPaths.thumb;
          patch.card_back_path_medium = patchPaths.medium;
        }
        const { error } = await supabaseAdmin
          .from("event_participants")
          .update(patch)
          .eq("id", u.id)
          .eq("event_id", data.eventId);
        if (error) throw error;
      }
    }
    return { ok: true };
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
  .inputValidator((d: unknown) => z.object({ eventId: zuuid() }).parse(d))
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
