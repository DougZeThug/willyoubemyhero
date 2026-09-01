# Fix: "file could not be read" when adding card art on a phone

## What happened

That red banner is the browser's own wording for a stale file handle
(`NotReadableError`). Nothing was wrong with the set — Allies & Accomplices is
fine, and the card would have filed into it correctly.

The upload flow stages the picked file, shows a preview, and only actually
**reads the bytes when you tap "Add 1 to the set"**. On Android, a file picked
from Gallery / Google Photos / Drive is a handle to a document the OS can
revoke at any moment. By the time you'd typed a name and a flavour line, the
handle had expired, so both the image decode and the fallback read failed and
the raw browser message got shown.

The preview thumbnail still rendered because it was captured at pick time.
That's the tell: the picture was grabbed early, the bytes weren't.

## The fix

1. **Read the bytes at pick time, not save time.** When a file is staged,
   immediately copy it into an in-memory blob and stage that copy. From then on
   the OS handle no longer matters — the phone can revoke it and the save still
   works.
2. **Fail on the file, not on the batch.** If a file genuinely can't be read
   when picked, that one file is rejected with a clear message ("Couldn't read
   <name> — pick it again, or save it to your phone first") and the rest of the
   batch stays staged. Today one bad file kills the whole save.
3. **Say something human.** Any remaining read failure at save time shows plain
   guidance instead of the browser's permission sentence.
4. Same treatment for the "replace art" picker and the roster/bulk card upload,
   which share the identical late-read pattern.

## Technical notes

- `src/lib/image-encode.ts`: add `snapshotFile(file)` that materialises the
  file (`file.arrayBuffer()` → `new File([buf], name, { type })`) and throws a
  typed, friendly error on `NotReadableError`. Keep the existing passthrough and
  downscale behaviour unchanged — snapshotting happens before it, not inside it.
- `src/components/secret-cards-panel.tsx` `addFiles()`: `await snapshotFile()`
  per file, store the snapshot on the draft, keep `URL.createObjectURL` on the
  snapshot so preview and upload use the same bytes. Per-file toast on failure.
  `saveDrafts()` and `replaceArt()` then encode the already-safe blob.
- `src/components/card-bulk-upload.tsx`: same snapshot-on-stage change.
- Tests: extend the image-encode unit tests for the snapshot helper (success and
  `NotReadableError` path) and a panel test that one unreadable file doesn't drop
  the other staged drafts.
- No schema, server-function, or styling changes. Verify with `bun run format`,
  `lint`, `typecheck`, `test`.
