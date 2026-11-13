// View-model rules the vault (/players) and /you share, so the two screens can
// never answer "is the collection known yet?" or "does this phone hold dust?"
// differently.
import { urlFromSet, type ImageUrlSet } from "@/lib/media";
import { summaryReady, vaultSummaryLine } from "@/lib/vault-summary";

export function idOf(event: { id?: string | null } | null | undefined) {
  return event?.id ?? null;
}

/** Members only: a guest has no dust balance, so the hook is handed nothing to ask about. */
export function dustHolder(dustOn: boolean, member: { participantId: string } | null | undefined) {
  return dustOn ? member?.participantId : null;
}

/** The collection's own flag, held back while an account is still being linked. */
export function collectionSettled(mineReady: boolean, sync: { status: string }) {
  return mineReady && sync.status !== "syncing";
}

/** The vault's one-line summary, or null until the roster has answered. */
export function summaryLine(
  ready: boolean,
  roster: Parameters<typeof summaryReady>[1],
  counts: Parameters<typeof vaultSummaryLine>[0],
) {
  return summaryReady(ready, roster) ? vaultSummaryLine(counts) : null;
}

/** The deck back to show on a secret, or null when the event has none. */
export function universalBack(urls: ImageUrlSet | null | undefined) {
  return urlFromSet(urls) ? (urls ?? null) : null;
}
