-- Mode D: hosted default speech-to-text.
--
-- Same reasoning as mode C (0004_hosted_search.sql): the desktop app ships
-- with no STT key of its own, a bundled key in a public Electron repo would
-- be a published key, so the broker holds it and the client sends audio
-- instead. One row per (install, UTC day), dropped by a retention sweep
-- rather than kept forever.
CREATE TABLE stt_usage (
  install_id TEXT    NOT NULL,
  day        TEXT    NOT NULL,
  count      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (install_id, day)
);

-- The global circuit breaker sums a whole day across every install.
CREATE INDEX idx_stt_usage_day ON stt_usage (day);
