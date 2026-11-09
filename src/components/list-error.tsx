/**
 * A list that failed to load, said as such, with a way to ask again.
 *
 * The shop's lists used to test `isLoading` and then `length === 0`, so a dead
 * connection fell through to "No spares yet." — which reads as an empty vault, and
 * somebody standing in a garden would believe it. This is the Vault's own
 * "Couldn't read the roster just now." pattern, shared because the shop and the
 * market need it in seven places and the wording should not drift between them.
 *
 * The button is 44px (`neon-btn-quiet` carries the min-height) so a thumb can
 * land it; the line sits left-aligned under the section prose like the empty lines
 * it replaces, rather than centred in a page-sized hole like the Vault's.
 */
export function ListError({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div role="alert" className="mt-3 flex flex-col items-start gap-2">
      <p className="text-meta text-muted-foreground">{`Couldn't read ${what} just now.`}</p>
      <button type="button" className="neon-btn-quiet" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
