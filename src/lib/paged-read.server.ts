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
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return rows;
  }
}
