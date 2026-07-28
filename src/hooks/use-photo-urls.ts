import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getEventPhotoUrls, getEventCardUrls } from "@/lib/media.functions";

// The storage bucket is private, so these are signed URLs. The server hands back
// the *same* URL string for a given file until it is close to expiring (see the
// signed URL cache in media.functions.ts), so refetching costs nothing and the
// browser keeps its cached copy of the artwork instead of downloading it again.
//
// The token itself is good for 8 hours; refresh at 3 so /tv and the vault, which
// get left open for whole afternoons, never reach the expiry cliff.
const SIGNED_URL_REFRESH_MS = 3 * 60 * 60_000;
// Long enough that bouncing vault → player → vault never refetches, and — more
// importantly — never drops the cached URLs and remounts every <img> from zero.
const URL_GC_MS = 8 * 60 * 60_000;
// A reload starts with no query cache at all, so every card used to wait on a
// round trip before its <img> even had a src. Keeping the last response in
// localStorage lets the grid start decoding art from the browser's own cache on
// the first frame. Capped well inside the token's 8 hour life so a stored URL is
// never handed out anywhere near expiry.
const SNAPSHOT_MAX_AGE_MS = 3.5 * 60 * 60_000;

type Snapshot<T> = { at: number; data: T };

function readSnapshot<T>(key: string): Snapshot<T> | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Snapshot<T>;
    if (!parsed?.at || Date.now() - parsed.at > SNAPSHOT_MAX_AGE_MS) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function writeSnapshot(key: string, data: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify({ at: Date.now(), data }));
  } catch {
    /* private mode, or the quota is full — the query just refetches instead */
  }
}

/** Shared wiring for the two URL queries: same caching, same reload snapshot. */
function useSignedUrls<T>(
  kind: string,
  eventId: string | null | undefined,
  fetcher: () => Promise<T>,
) {
  const storageKey = `wwbh:${kind}:${eventId ?? ""}`;
  const qc = useQueryClient();

  // Seeded after hydration rather than as `initialData`: the server has no
  // localStorage, and handing the client a different first render than the one
  // it is hydrating is how you get a mismatch on every card's src.
  useEffect(() => {
    if (!eventId) return;
    const key = [kind, eventId];
    if (qc.getQueryData(key)) return;
    const snapshot = readSnapshot<T>(storageKey);
    if (snapshot) qc.setQueryData(key, snapshot.data, { updatedAt: snapshot.at });
  }, [qc, kind, eventId, storageKey]);

  const query = useQuery({
    queryKey: [kind, eventId],
    queryFn: fetcher,
    enabled: !!eventId,
    staleTime: SIGNED_URL_REFRESH_MS,
    gcTime: URL_GC_MS,
    refetchInterval: SIGNED_URL_REFRESH_MS,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: false,
  });

  const data = query.data;
  useEffect(() => {
    if (eventId && data) writeSnapshot(storageKey, data);
  }, [eventId, storageKey, data]);

  return query;
}

export function useEventPhotoUrls(eventId: string | null | undefined) {
  const fn = useServerFn(getEventPhotoUrls);
  return useSignedUrls("photo-urls", eventId, () => fn({ data: { eventId: eventId! } }));
}

export function useEventCardUrls(eventId: string | null | undefined) {
  const fn = useServerFn(getEventCardUrls);
  return useSignedUrls("card-urls", eventId, () => fn({ data: { eventId: eventId! } }));
}
