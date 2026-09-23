ALTER TABLE issuances ADD COLUMN key_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_issuances_key_hash ON issuances(key_hash);
