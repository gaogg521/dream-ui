-- Make issuances vendor-aware.
--
-- Three changes, and only the last needs a table rebuild:
--   1. record which vendor issued the key,
--   2. rename openrouter_key_hash -> vendor_key_handle, since "hash" is
--      OpenRouter's word for it and another platform will call it something
--      else,
--   3. move the dedup key from install_id alone to (vendor, install_id) —
--      one device should be able to hold one key per vendor, not one key
--      total.
--
-- (3) cannot be done with ALTER: the old UNIQUE is a column constraint in the
-- CREATE TABLE, and SQLite has no DROP CONSTRAINT. Hence the copy-and-swap.
-- Existing rows all predate multi-vendor support, so they are OpenRouter's.

CREATE TABLE issuances_new (
  id TEXT PRIMARY KEY,
  vendor TEXT NOT NULL,
  install_id TEXT NOT NULL,
  ip TEXT NOT NULL,
  vendor_key_handle TEXT NOT NULL,
  issued_at INTEGER NOT NULL,   -- unix ms
  expires_at INTEGER NOT NULL,  -- unix ms
  disabled INTEGER NOT NULL DEFAULT 0,
  UNIQUE (vendor, install_id)
);

INSERT INTO issuances_new (id, vendor, install_id, ip, vendor_key_handle, issued_at, expires_at, disabled)
SELECT id, 'openrouter', install_id, ip, openrouter_key_hash, issued_at, expires_at, disabled
FROM issuances;

DROP TABLE issuances;
ALTER TABLE issuances_new RENAME TO issuances;

CREATE INDEX idx_issuances_issued_at ON issuances (issued_at);
-- Reading a key's spend position starts from the handle the vendor gave us.
CREATE INDEX idx_issuances_handle ON issuances (vendor, vendor_key_handle);
