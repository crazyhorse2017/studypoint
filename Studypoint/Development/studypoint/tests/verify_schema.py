"""
Schema tests for migrations/ (DATABASE.md, T0.11), using Python's built-in SQLite. D1 is SQLite.

Checks that:
  - every migration applies cleanly to an empty database, in order
  - the tables match the CREATE TABLE statements in docs/DATABASE.md (no doc/schema drift)
  - foreign keys and CHECK constraints are enforced
  - the database starts empty (LIB-12), except the export schema version in schema_meta
  - the passages FTS5 index stays in sync through its triggers

Usage:
  uv run --no-project --python 3.12 python tests/verify_schema.py

CI also applies the migrations to real D1 (local workerd) once the pool-workers tests land (T0.04).
"""

from __future__ import annotations

import re
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MIGRATIONS = sorted((ROOT / "migrations").glob("[0-9][0-9][0-9][0-9]_*.sql"))

results: list[tuple[bool, str, str]] = []


def check(name: str):
    def wrap(fn):
        try:
            fn()
            results.append((True, name, ""))
        except Exception as e:  # report every failure, don't stop at the first
            results.append((False, name, f"{type(e).__name__}: {e}"))
        return fn
    return wrap


def fresh_db() -> sqlite3.Connection:
    db = sqlite3.connect(":memory:")
    db.execute("PRAGMA foreign_keys = ON")
    for path in MIGRATIONS:
        db.executescript(path.read_text(encoding="utf-8"))
    db.execute("PRAGMA foreign_keys = ON")  # executescript can reset nothing, but be explicit
    return db


def expect_error(db: sqlite3.Connection, sql: str, params: tuple = (), fragment: str = "") -> None:
    try:
        db.execute(sql, params)
    except sqlite3.IntegrityError as e:
        if fragment and fragment.lower() not in str(e).lower():
            raise AssertionError(f"Expected error containing {fragment!r}, got {e}") from e
        return
    raise AssertionError(f"Expected IntegrityError for: {sql}")


NOW = 1_795_000_000_000


def seed_minimal(db: sqlite3.Connection) -> None:
    """Rows needed to exercise passages. Test-only: never used by the app (LIB-12)."""
    db.execute("INSERT INTO users (id, email, created_at) VALUES ('u1', 'ci@studypoint.invalid', ?)", (NOW,))
    db.execute("""INSERT INTO sources (id, user_id, title, kind, origin, privacy, created_at, updated_at)
                  VALUES ('s1', 'u1', 'Synthetic source', 'pdf', 'upload', 'published', ?, ?)""", (NOW, NOW))
    db.execute("""INSERT INTO source_versions (id, source_id, version_no, content_hash, r2_key, mime, bytes, status, created_at)
                  VALUES ('v1', 's1', 1, 'h', 'k', 'application/pdf', 10, 'ready', ?)""", (NOW,))
    db.execute("""INSERT INTO locations (id, source_version_id, ordinal, kind, label, extraction, content_hash)
                  VALUES ('l1', 'v1', 1, 'page', 'p. 1', 'text', 'h')""")


@check("migrations exist and are numbered from 0001")
def _():
    assert MIGRATIONS, "No migrations found"
    assert MIGRATIONS[0].name.startswith("0001_"), MIGRATIONS[0].name


@check("all migrations apply to an empty database")
def _():
    fresh_db()


@check("FTS5 and JSON functions are available (D1 supports both)")
def _():
    db = sqlite3.connect(":memory:")
    db.execute("CREATE VIRTUAL TABLE t USING fts5(x)")
    assert db.execute("SELECT json_valid('{}')").fetchone()[0] == 1


@check("tables match docs/DATABASE.md exactly")
def _():
    doc = (ROOT / "docs" / "DATABASE.md").read_text(encoding="utf-8")
    doc_tables = set(re.findall(r"CREATE (?:VIRTUAL )?TABLE (\w+)", "\n".join(re.findall(r"```sql\n(.*?)```", doc, re.S))))
    db = fresh_db()
    rows = db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchall()
    real = {r[0] for r in rows if not re.match(r"passages_fts_", r[0])}  # FTS5 shadow tables
    assert doc_tables == real, f"Only in doc: {sorted(doc_tables - real)}; only in migrations: {sorted(real - doc_tables)}"


@check("database starts empty (LIB-12): no rows except schema_meta")
def _():
    db = fresh_db()
    tables = [r[0] for r in db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'passages_fts%'")]
    nonempty = {t: n for t in tables if (n := db.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]) and t != "schema_meta"}
    assert not nonempty, f"Tables with rows: {nonempty}"
    assert db.execute("SELECT value FROM schema_meta WHERE key='export_schema_version'").fetchone() == ("1",)


@check("foreign keys are enforced")
def _():
    db = fresh_db()
    expect_error(db, """INSERT INTO courses (id, user_id, name, institution_name, created_at, updated_at)
                        VALUES ('c1', 'nobody', 'X', 'Y', 1, 1)""", fragment="FOREIGN KEY")


@check("CHECK constraints: settings enums and ranges")
def _():
    db = fresh_db()
    db.execute("INSERT INTO users (id, email, created_at) VALUES ('u1', 'ci@studypoint.invalid', 1)")
    expect_error(db, "INSERT INTO settings (user_id, style, updated_at) VALUES ('u1', 'neon', 1)", fragment="CHECK")
    expect_error(db, "INSERT INTO settings (user_id, target_retention, updated_at) VALUES ('u1', 0.99, 1)", fragment="CHECK")
    db.execute("INSERT INTO settings (user_id, updated_at) VALUES ('u1', 1)")
    row = db.execute("SELECT style, theme, daily_minutes, target_retention, fsrs_version, mixed_privacy_mode FROM settings").fetchone()
    assert row == ("paper", "system", 20, 0.9, "fsrs-6", "private_all"), row


@check("AI primers can never be citeable (LKP-04)")
def _():
    db = fresh_db()
    db.execute("INSERT INTO users (id, email, created_at) VALUES ('u1', 'ci@studypoint.invalid', 1)")
    expect_error(db, """INSERT INTO sources (id, user_id, title, kind, origin, privacy, citeable, created_at, updated_at)
                        VALUES ('s1', 'u1', 'Primer', 'primer', 'ai_primer', 'published', 1, 1, 1)""", fragment="CHECK")


@check("review ratings must be 1-4, and client_id is idempotent")
def _():
    db = fresh_db()
    db.execute("INSERT INTO users (id, email, created_at) VALUES ('u1', 'ci@studypoint.invalid', 1)")
    db.execute("""INSERT INTO cards (id, user_id, type, front_md, origin, created_at, updated_at)
                  VALUES ('k1', 'u1', 'basic', 'Q', 'manual', 1, 1)""")
    base = """INSERT INTO review_log (id, user_id, card_id, variant, rating, reviewed_at, state_before, scheduled_days,
              fsrs_version, params_hash, client_id) VALUES (?, 'u1', 'k1', 'main', ?, 1, 'new', 1, 'fsrs-6', 'p', ?)"""
    expect_error(db, base, ("r0", 5, "c0"), fragment="CHECK")
    db.execute(base, ("r1", 3, "c1"))
    expect_error(db, base, ("r2", 3, "c1"), fragment="UNIQUE")


@check("passages FTS5 index follows insert, update and delete")
def _():
    db = fresh_db()
    seed_minimal(db)
    ins = """INSERT INTO passages (id, user_id, source_id, source_version_id, location_id, ordinal, text, content_hash,
             token_count, privacy, citeable) VALUES (?, 'u1', 's1', 'v1', 'l1', ?, ?, 'h', 5, 'published', 1)"""
    db.execute(ins, ("p1", 1, "Entropy measures the dispersal of energy"))
    db.execute(ins, ("p2", 2, "Torque equals force times lever arm"))
    match = lambda q: [r[0] for r in db.execute(  # noqa: E731
        "SELECT p.id FROM passages_fts f JOIN passages p ON p.rowid = f.rowid WHERE passages_fts MATCH ? ORDER BY p.id", (q,))]
    assert match("entropy") == ["p1"], match("entropy")
    assert match("forces") == ["p2"], "porter stemming should match 'forces' to 'force'"
    db.execute("UPDATE passages SET text = 'Enthalpy is heat content at constant pressure' WHERE id = 'p1'")
    assert match("entropy") == [] and match("enthalpy") == ["p1"]
    db.execute("DELETE FROM passages WHERE id = 'p2'")
    assert match("torque") == []


@check("deleting a source cascades to versions, locations and passages")
def _():
    db = fresh_db()
    seed_minimal(db)
    db.execute("""INSERT INTO passages (id, user_id, source_id, source_version_id, location_id, ordinal, text, content_hash,
                  token_count, privacy, citeable) VALUES ('p1', 'u1', 's1', 'v1', 'l1', 1, 'text', 'h', 1, 'published', 1)""")
    db.execute("DELETE FROM sources WHERE id = 's1'")
    for t in ("source_versions", "locations", "passages"):
        assert db.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] == 0, t


@check("course codes: duplicate catalog cache entries are rejected (INS-06)")
def _():
    db = fresh_db()
    db.execute("INSERT INTO users (id, email, created_at) VALUES ('u1', 'ci@studypoint.invalid', 1)")
    ins = """INSERT INTO catalog_courses (id, user_id, institution_key, subject_code, course_number, title, url, fetched_at)
             VALUES (?, 'u1', '999999', 'CHEM', '101', 'General Chemistry', 'https://example.edu/c', 1)"""
    db.execute(ins, ("a",))
    expect_error(db, ins, ("b",), fragment="UNIQUE")


def main() -> int:
    for ok, name, detail in results:
        print(f"{'PASS' if ok else 'FAIL'}: {name}" + (f"\n  {detail}" if detail else ""))
    failed = sum(1 for ok, _, _ in results if not ok)
    print(f"\nSchema tests: {len(results) - failed}/{len(results)} passed (SQLite {sqlite3.sqlite_version}).")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
