import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getCardPullCounts } from "@/lib/card-pulls.functions";
import type { CardPullCounts } from "@/lib/card-pulls";

export const cardPullCountsKey = (eventId: string | null | undefined) =>
  ["card-pull-counts", eventId] as const;

/**
 * How many people have packed each card in this event.
 *
 * No realtime subscription: `card_pulls` is deliberately out of the publication —
 * broadcasting a pull would attach the puller's id to it — and the number moves
 * at most once a day per person, so window focus is refresh enough.
 */
export function useCardPullCounts(eventId: string | null | undefined) {
  const fn = useServerFn(getCardPullCounts);
  return useQuery({
    queryKey: cardPullCountsKey(eventId),
    queryFn: () => fn({ data: { eventId: eventId! } }) as Promise<CardPullCounts>,
    enabled: !!eventId,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}
