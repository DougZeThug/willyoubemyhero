import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getEventPhotoUrls, getEventCardUrls } from "@/lib/media.functions";

// The storage bucket is private, so these are signed URLs that expire after an
// hour (see media.functions.ts). Refresh well inside that window and keep doing
// it in the background — /tv and the vault get left open for whole afternoons,
// and without this every image would break at exactly the 60 minute mark.
const SIGNED_URL_REFRESH_MS = 45 * 60_000;

export function useEventPhotoUrls(eventId: string | null | undefined) {
  const fn = useServerFn(getEventPhotoUrls);
  return useQuery({
    queryKey: ["photo-urls", eventId],
    queryFn: () => fn({ data: { eventId: eventId! } }),
    enabled: !!eventId,
    staleTime: 30 * 60_000,
    refetchInterval: SIGNED_URL_REFRESH_MS,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: false,
  });
}

export function useEventCardUrls(eventId: string | null | undefined) {
  const fn = useServerFn(getEventCardUrls);
  return useQuery({
    queryKey: ["card-urls", eventId],
    queryFn: () => fn({ data: { eventId: eventId! } }),
    enabled: !!eventId,
    staleTime: 30 * 60_000,
    refetchInterval: SIGNED_URL_REFRESH_MS,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: false,
  });
}
