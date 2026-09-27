-- The balance this broker shows the user is never the vendor's real spend
-- cap (see src/visible_balance.rs) — the resale markup must stay invisible.
-- Free grants and real top-ups are tracked as two separate pools so
-- consumption can spend the free grant first, at 1:1, with the markup ratio
-- never touching it at all; only once the grant is exhausted does spending
-- start drawing down the paid pool (which is where the markup lives).
--
-- All six columns are nullable: rows from before this migration get it
-- lazily, on first access, from whatever the vendor's real remain happens to
-- be at that moment (see visible_balance::reconcile_usage) — there is no way
-- to reconstruct how a historical payment split between grant and paid.
ALTER TABLE issuances ADD COLUMN grant_limit_cny REAL;
ALTER TABLE issuances ADD COLUMN grant_balance_cny REAL;
ALTER TABLE issuances ADD COLUMN paid_limit_cny REAL;
ALTER TABLE issuances ADD COLUMN paid_balance_cny REAL;
ALTER TABLE issuances ADD COLUMN paid_real_remain_cny REAL;
ALTER TABLE issuances ADD COLUMN last_synced_vendor_remain REAL;
