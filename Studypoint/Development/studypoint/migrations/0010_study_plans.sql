-- Migration 0010 (2026-11-27): one study plan per course (step 6b, ARCHITECTURE A26). The automatic
-- practice test, the topic scores from it, and the day-by-day plan built from them live in ONE encrypted
-- payload. Only the stage is in the clear, so the app can find unfinished work without decrypting.
CREATE TABLE study_plans (
  course_id TEXT PRIMARY KEY REFERENCES courses(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (stage IN ('building','test_ready','active','failed')),
  payload TEXT NOT NULL,          -- sf1 ciphertext, AAD "<course id>#plan"
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),   -- bumped on every save (stale-tab check)
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_study_plans_user ON study_plans(user_id, stage);
