/**
 * The message of whatever was thrown, or `fallback` when it carries none.
 *
 * Reads `Error`s and plain `{ message }` objects alike: supabase-js hands back
 * error objects that are not `Error` instances, and a rejection that crossed a
 * serialisation boundary can lose its prototype.
 */
export function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof Error) return e.message;
  if (
    typeof e === "object" &&
    e !== null &&
    typeof (e as { message?: unknown }).message === "string"
  ) {
    return (e as { message: string }).message;
  }
  return fallback;
}
