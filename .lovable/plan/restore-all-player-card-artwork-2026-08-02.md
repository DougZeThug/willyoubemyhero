# Restore all player card artwork

## Confirmed diagnosis

The database now points to the regenerated thumbnail, medium, and large files, and the universal back also has regenerated variants. However, the open player vault is still rendering older, pre-backfill signed URLs from the browser snapshot cache. `useSignedUrls` restores that snapshot as fresh for up to 3.5 hours, while the query itself remains fresh for 3 hours, so it does not promptly ask the server for the new paths. The screenshot and live DOM both show those old original PNG paths, while a current card-back server response contains the newer backfilled paths.

This is why the prior backfill did not repair phones that had already cached the old URL response.

## Implementation plan

1. **Stop stale signed-path snapshots from winning**
   - Version the persisted card URL snapshot format/key so existing broken snapshots are discarded immediately.
   - Treat a restored snapshot only as temporary display data and always revalidate it against the server rather than marking it fresh for hours.
   - Keep the in-memory/server URL cache so normal vault-to-player navigation remains fast.

2. **Make image fallback recover from bad URL sets**
   - Reset front and back retry state whenever any URL in the image set changes, not only when the large URL changes.
   - Retry explicit medium and thumbnail URLs without carrying an old `srcset` candidate that can make the browser repeatedly choose the failed large/original image.
   - Preserve the placeholder only for genuinely absent art or after every distinct candidate has failed.

3. **Use the universal back consistently**
   - Keep individual player backs falling back to the event’s current universal back.
   - Ensure the player detail view receives the newly revalidated universal-back URLs instead of an old per-player cached response.

4. **Add regression coverage**
   - Test that a persisted card URL snapshot is shown only provisionally and triggers an immediate server refresh.
   - Test that changing thumb/medium paths resets failed-image state.
   - Test fallback order without `srcset` reselecting a previously failed candidate.
   - Test player cards receive the universal back when no personal back exists.

5. **Verify the real user flow**
   - Open the vault at a 360px mobile viewport with a previously populated browser cache.
   - Confirm every visible player front decodes with non-zero dimensions and no failed image requests.
   - Open an individual player, flip the card, and confirm both the front and universal back decode.
   - Reload and repeat to verify the repaired cache behavior persists.

## Scope

This change is limited to card image delivery, cache invalidation, fallback behavior, and tests. It will not alter the roster, card artwork, or unrelated app behavior.