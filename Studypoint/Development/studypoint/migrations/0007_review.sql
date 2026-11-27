-- Migration 0007 (2026-11-27): flashcard review (step 4, CRD-05/06).
-- New cards per day (Alex chose 20), and the FSRS 6 learning-step position each card is at, which the
-- scheduler needs to continue (re)learning steps correctly after a restart.
ALTER TABLE settings ADD COLUMN new_per_day INTEGER NOT NULL DEFAULT 20 CHECK (new_per_day BETWEEN 0 AND 200);
ALTER TABLE card_states ADD COLUMN learning_steps INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_card_states_new ON card_states(user_id, state);
CREATE INDEX idx_deadlines_user_due ON deadlines(user_id, due_at);
