CREATE TABLE issuances (
  id TEXT PRIMARY KEY,
  install_id TEXT NOT NULL UNIQUE,
  ip TEXT NOT NULL,
  openrouter_key_hash TEXT NOT NULL,
  issued_at INTEGER NOT NULL,   -- unix ms
  expires_at INTEGER NOT NULL,  -- unix ms
  disabled INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_issuances_issued_at ON issuances (issued_at);
