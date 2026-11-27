-- Migration 0004 (2026-11-26): the encryption vault (AUTH-08, ARCHITECTURE A19/A20).
-- The server only ever stores WRAPPED keys and a key-check ciphertext. It can't unlock anything.
CREATE TABLE vault (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version = 1),
  kdf TEXT NOT NULL CHECK (kdf IN ('pbkdf2-sha256')),
  pass_iterations INTEGER NOT NULL CHECK (pass_iterations >= 100000),
  pass_salt TEXT NOT NULL,
  pass_wrapped TEXT NOT NULL,
  recovery_iterations INTEGER NOT NULL CHECK (recovery_iterations >= 100000),
  recovery_salt TEXT NOT NULL,
  recovery_wrapped TEXT NOT NULL,
  key_check TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- One row per passkey that can unlock the vault (WebAuthn PRF). credential_id is base64url.
CREATE TABLE vault_passkeys (
  credential_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  prf_salt TEXT NOT NULL,
  wrapped TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX idx_vault_passkeys_user ON vault_passkeys(user_id);
