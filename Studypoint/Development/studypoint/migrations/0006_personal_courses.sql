-- Migration 0006 (2026-11-26): personal courses (LIB-01b). A subject studied for its own sake, with no
-- school and no subject code. Existing courses are all college courses. Personal courses store an empty
-- institution_name (the column is NOT NULL) and NULL unitid/domain/code.
ALTER TABLE courses ADD COLUMN kind TEXT NOT NULL DEFAULT 'college' CHECK (kind IN ('college','personal'));
