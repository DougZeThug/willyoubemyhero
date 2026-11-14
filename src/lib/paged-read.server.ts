/**
 * PostgREST answers at most 1000 rows to a plain SELECT and says nothing when it
 * stops there, so a table that has outgrown the cap reads as a complete one that
 * happens to be short. Fine for a screen; wrong for a snapshot that is stored for
 * good or an audit whose whole job is to notice what is missing.
 */
const PAGE_SIZE = 1000;

type PageResult<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/**
 * Read every row a query matches, a page at a time.
 *
 * `page` must carry a total, unique ordering: offset paging over a tie-prone
 * order can repeat one row and skip another between pages. Any failed page
 * throws rather than returning what was read so far — a partial read is exactly
 * the silent truncation this exists to prevent.
 */
export async function readAllRows<T>(
  page: (from: number, to: number) => PageResult<T>,
): Promise<T[]> {
  const rows: T[] = [];
  // The next page starts after the rows actually received, not after PAGE_SIZE:
  // a server whose row cap is below PAGE_SIZE answers short pages, and stepping
  // by PAGE_SIZE would skip the rows between them. So the read ends on an empty
  // page, never on a short one.
  for (;;) {
    const { data, error } = await page(rows.length, rows.length + PAGE_SIZE - 1);
    if (error) throw error;
    const batch = data ?? [];
    if (batch.length === 0) return rows;
    rows.push(...batch);
  }
}
