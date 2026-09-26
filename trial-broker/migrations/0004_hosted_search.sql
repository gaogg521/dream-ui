-- Mode C: hosted web search.
--
-- The desktop app ships with no search key of its own. Hardcoding one would
-- not work: dream-ui is a public repository and an Electron asar is readable,
-- so a bundled key is a published key — scanned, revoked, and then broken for
-- every user at once. The broker holds the key instead and the client sends
-- only a query, exactly the reasoning behind mode B.
--
-- Unlike mode B no money is tracked here, so there is no ledger: a search is
-- one unit and the only thing worth remembering is how many a device has run
-- today. One row per (install, UTC day), dropped by a retention sweep rather
-- than kept forever.
CREATE TABLE search_usage (
  install_id TEXT    NOT NULL,
  -- UTC calendar day, 'YYYY-MM-DD'. A text day rather than a timestamp
  -- because the quota question is always "how many today", and a string key
  -- makes that an equality lookup instead of a range scan.
  day        TEXT    NOT NULL,
  count      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (install_id, day)
);

-- The global circuit breaker sums a whole day across every install.
CREATE INDEX idx_search_usage_day ON search_usage (day);
