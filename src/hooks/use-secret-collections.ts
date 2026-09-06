import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getSecretCollections } from "@/lib/secret-cards.functions";
import type { SecretCollection } from "@/lib/secret-cards";

/**
 * The sets, purely for their names, their colours and their order.
 *
 * Says nothing about what is inside one — the response carries no sizes, by
 * design — so the vault's silence about unpulled cards holds even though this
 * travels to a phone that owns nothing from any of them.
 *
 * Lifted out of the vault, which asked for this inline, once the set chip needed
 * the same list in the viewer, the trade screen and the shop. One query key
 * across all four, so the three new callers cost nothing over the wire.
 *
 * `undefined` while it is still in the air, and NOT the shipped list: the two are
 * different answers. Every consumer here forwards it to `secretCollectionLabel`
 * or `setAccent`, whose default parameter is that shipped list — so an unanswered
 * query falls back to the four sets that shipped, while a genuinely empty one
 * stays empty and a card keeps its raw id rather than borrowing a stale label.
 */
export function useSecretCollections(): readonly SecretCollection[] | undefined {
  const fn = useServerFn(getSecretCollections);
  const q = useQuery({
    queryKey: ["secret-collections"],
    queryFn: () => fn(),
    staleTime: 30 * 60_000,
  });
  return q.data?.collections;
}
