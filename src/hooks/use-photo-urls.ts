import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getEventPhotoUrls } from "@/lib/media.functions";

export function useEventPhotoUrls(eventId: string | null | undefined) {
  const fn = useServerFn(getEventPhotoUrls);
  return useQuery({
    queryKey: ["photo-urls", eventId],
    queryFn: () => fn({ data: { eventId: eventId! } }),
    enabled: !!eventId,
    staleTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });
}