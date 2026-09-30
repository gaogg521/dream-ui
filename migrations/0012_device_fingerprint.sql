-- A privacy-preserving, stable-per-machine secondary identity. The client
-- sends only SHA-256(namespace || operating-system machine identifier), never
-- the raw OS identifier. It lets an install recover its existing entitlement
-- after its app data (and therefore its random install id) is cleared.
ALTER TABLE issuances ADD COLUMN device_fingerprint TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_issuances_vendor_device_fingerprint
    ON issuances(vendor, device_fingerprint)
    WHERE device_fingerprint IS NOT NULL;
