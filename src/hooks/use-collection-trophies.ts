import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getCollectionTrophies } from "@/lib/secret-cards.functions";
import type { CollectionTrophy } from "@/lib/collection-trophies";

export const collectionTrophiesKey = () => ["collection-trophies"] as const;

/**
 * Every finished set in the league.
 *
 * Not keyed on an actor, unlike every other collection hook here: this is public
 * data, thirteen people's worth of rows at the very most, and three surfaces read
 * it — your own shelf, the badge on a card back, and somebody else's player page.
 * One cache entry rather than three keeps them consistent with each other.
 *
 * SUBSCRIBED, unlike useMySecrets — which is deliberately not, because publishing
 * secret_card_pulls would broadcast every pull to every phone. collection_trophies
 * is the opposite: nothing on it is private, and the subscription is the only way
 * an admin grant ever reaches the person it completed a set for. grantSecretCard
 * runs on the commissioner's phone and can invalidate nothing but their own keys.
 */
export function useCollectionTrophies() {
  const fn = useServerFn(getCollectionTrophies);
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: collectionTrophiesKey(),
    queryFn: () => fn() as Promise<{ trophies: CollectionTrophy[] }>,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    const channel = supabase
      // The random suffix is what lets two tabs hold their own channel, same as
      // useTradeFeed.
      .channel(`collection-trophies:${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "collection_trophies" },
        () => {
          // INSERT only: a trophy is written once and never updated. Invalidate,
          // never merge — the payload has no label on it and the server resolves
          // that, which is the same rule use-trade-nudge states.
          qc.invalidateQueries({ queryKey: collectionTrophiesKey() });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);

  return query;
}
