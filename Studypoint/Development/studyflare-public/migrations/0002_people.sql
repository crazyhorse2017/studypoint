-- 0002_people.sql: people the owner has invited (AUTH-06, Settings → People).
-- App-level access list, not user-owned content. The owner's own emails stay in the OWNER_EMAILS /
-- ALLOWED_EMAILS secrets (so the owner can never be locked out by a database change).
-- Each invited person gets a separate account on first sign-in (AUTH-03b).

CREATE TABLE allowed_emails (
  email TEXT PRIMARY KEY,                                  -- lowercased
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member')),
  added_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
