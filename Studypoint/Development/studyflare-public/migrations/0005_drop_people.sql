-- Migration 0005 (2026-11-26): Settings → People removed (ARCHITECTURE A21). Each person deploys their own
-- Studyflare instead (AUTH-07), so the app-wide invite list is gone. Contract step: since 2026-11-26 no
-- Worker version reads this table (the previous one only looked emails up in it, failing closed on error).
DROP TABLE IF EXISTS allowed_emails;
