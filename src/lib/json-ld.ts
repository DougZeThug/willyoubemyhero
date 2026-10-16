/**
 * Serialises a JSON-LD object for use as the body of an inline
 * `<script type="application/ld+json">`.
 *
 * `JSON.stringify` leaves `<`, `>` and `&` alone, so a string containing
 * `</script>` closes the data block and whatever follows runs as script. Route
 * params are attacker-controlled, so anything built from one must go through
 * here. The escapes are all valid JSON string escapes: a crawler parses back the
 * identical object, but the HTML parser never sees a tag or comment opener.
 * U+2028 / U+2029 are escaped too, since older script parsers treat them as
 * line terminators.
 */
export function jsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/gu, "\\u2028")
    .replace(/\u2029/gu, "\\u2029");
}
