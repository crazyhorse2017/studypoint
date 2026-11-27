-- Migration 0008 (2026-11-27): processed material for AI (step 5, ARCHITECTURE A24).
-- Each source (file, imported page or note) is processed IN THE BROWSER into passages + search vectors,
-- encrypted as one bundle and stored in R2 at index/<user>/<source>. This row only says a bundle exists
-- and which version of the content it was built from (an HMAC fingerprint, not the content).
CREATE TABLE source_index (
  source_id TEXT PRIMARY KEY REFERENCES sources(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  passages INTEGER NOT NULL CHECK (passages >= 0),
  embed_model TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_source_index_user ON source_index(user_id);
