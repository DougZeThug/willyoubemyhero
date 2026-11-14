import { useQuery } from "@tanstack/react-query";

/**
 * A read behind the member guard.
 *
 * Never retried: a token that expired mid-party should surface the claim prompt
 * (or the local collection) straight away, not retry three times behind a
 * spinner against a handler that will keep refusing. `enabled` is required so
 * a phone changing hands never paints the previous person's answer.
 */
export function useMemberQuery<T>(options: {
  queryKey: readonly unknown[];
  queryFn: () => Promise<T>;
  enabled: boolean;
  staleTime: number;
}) {
  return useQuery({ ...options, retry: false });
}
