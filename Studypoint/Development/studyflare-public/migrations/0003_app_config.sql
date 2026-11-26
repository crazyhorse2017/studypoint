-- Migration 0003 (2026-11-26): deployment settings written by first-run setup (AUTH-07).
-- One row per key: the Access team domain and AUD, plus the Cloudflare ids Settings → People needs.
-- App-level, not user-owned, and never exported. Values are public identifiers, never tokens.
CREATE TABLE app_config (
  key TEXT PRIMARY KEY CHECK (key IN ('team_domain','aud','account_id','app_id','policy_id','brand_app_id','setup_at')),
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
