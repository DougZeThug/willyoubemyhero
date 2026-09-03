/**
 * Pass NULL to an RPC argument the generated types insist is non-null.
 *
 * `supabase gen types` has no way to know which function arguments accept NULL —
 * every parameter comes out as its bare Postgres type — while several of ours
 * are deliberately nullable: a pull is by a member OR a guest, an event id is
 * absent out of season, `_editions` is kept only so an old client's call still
 * resolves. Widening at the call site keeps the payload readable and localises
 * the fib to one named function instead of a cast per key.
 */
export function sqlNull<T>(value: T | null): NonNullable<T> {
  return value as NonNullable<T>;
}
