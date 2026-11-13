/** The message of a thrown `Error`, or `fallback` for anything else that was thrown. */
export function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}
