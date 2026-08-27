# Fix: selling a secret card always fails

## What's wrong

Selling any secret from the shop fails with "Could not sell that one" — it is not a
last-copy rule, and it is not a code bug in the app.

The database routine that runs a sale calls a small helper that works out what a
secret is worth by its level (Common 15 … Mythic 300). That helper was never
created in the live database: the migration that introduced it,
`20260829120000_sell_secrets.sql`, was skipped, while the later marketplace
migration — which calls the helper — was applied. So every sale throws before it
gets anywhere, and the shop shows its generic failure toast.

Verified against the live database:

- `sell_secret_card` exists and is the current version, with no last-copy guard.
- `secret_sell_value(text)` does **not** exist.
- The ledger reason list, the source list and the earn-once index are all already
  correct, so nothing else from that migration is missing.

The "last copy" label in the screenshot is just the shop warning you the card
leaves your vault; it never blocked the sale.

## The fix

One migration that creates the missing helper exactly as
`20260829120000_sell_secrets.sql` defines it, and nothing else:

```sql
CREATE OR REPLACE FUNCTION public.secret_sell_value(_tier text)
RETURNS int LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = public
AS $$
  SELECT COALESCE((ARRAY[300, 120, 60, 30, 15])[public.secret_tier_rank(_tier)], 15);
$$;

REVOKE ALL ON FUNCTION public.secret_sell_value(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.secret_sell_value(text) TO service_role;
```

No app code changes: the shop, the server function and the payouts are all
already correct and will start working the moment the helper exists.

## Checking it worked

- Query the live database to confirm the function exists and returns 15 for
  `common` and 300 for `mythic`.
- Confirm `sell_secret_card` runs end to end for a real spare, including a last
  copy, and that the seller's balance moves by the right amount.
