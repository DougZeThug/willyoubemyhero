import { z } from "zod";

/**
 * A UUID check that accepts every id this database actually holds.
 *
 * Zod 4's `.uuid()` enforces RFC 9562 version *and* variant nibbles, and the
 * seeded ids in this project — the combine's own `1111…1111`, the roster's
 * `c0000000-…-000000000011` — are valid Postgres uuids that fail that test. The
 * validators here exist to reject junk, not to police uuid versions, so match
 * the shape Postgres does.
 */
export const uuid = () =>
  z.string().regex(/^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/, "Invalid UUID");
