-- Per-provider monthly call counter.
--
-- Mode C's first provider is on a free allowance -- Tavily gives 1000 calls a
-- month -- and the point of the second provider is to take over when that runs
-- out. Waiting for the vendor to start refusing would mean guessing which
-- status code it uses for an exhausted plan, and finding out only after the
-- first rejected search; worse, on a plan that silently bills past the free
-- tier it would mean finding out on the invoice. Counting our own calls makes
-- the handover exact and free of assumptions about the vendor.
--
-- Separate from `search_usage`, which answers a different question: that one
-- is per device per day and exists to stop one user spending everyone's quota.
-- This one is per vendor per month and exists to decide which vendor to call.
CREATE TABLE search_provider_usage (
  provider TEXT    NOT NULL,
  -- UTC calendar month, 'YYYY-MM'. The vendor's allowance resets monthly, and
  -- an equality lookup on a text month is all the question ever needs.
  month    TEXT    NOT NULL,
  count    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (provider, month)
);
