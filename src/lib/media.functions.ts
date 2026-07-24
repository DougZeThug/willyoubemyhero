import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { verifyAdminToken } from "./session.server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

async function requireAdmin(eventId: string) {
  const token = getRequestHeader("x-admin-token") ?? null;
  const claims = verifyAdminToken(token);
  if (!claims || claims.eventId !== eventId) {
    throw new Error("Admin PIN required");
  }
}

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
      supabaseAdmin.from("runs").select("*").eq("event_id", data.eventId),
      supabaseAdmin.from("splits").select("*"),
      supabaseAdmin.from("penalties").select("*"),
      supabaseAdmin.from("draft_selections").select("*").eq("event_id", data.eventId),
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