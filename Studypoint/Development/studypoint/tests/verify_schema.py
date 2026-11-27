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


def json_dump(row: tuple) -> str:
    return "|".join("" if v is None else str(v) for v in row)


def export_tables() -> list[tuple[str, str]]:
    """Read EXPORT_TABLES from src/worker/backup/tables.ts and expand viaParent(...) into SQL."""
    src = (ROOT / "src" / "worker" / "backup" / "tables.ts").read_text(encoding="utf-8")
    body = src[src.index("EXPORT_TABLES"):src.index("];", src.index("EXPORT_TABLES"))]

    def via(m: re.Match[str]) -> str:
        return f"{m.group(1)} IN (SELECT id FROM {m.group(2)} WHERE user_id = ?1)"

    out = []
    for name, scope in re.findall(r"\{ name: '(\w+)', scope: (.+?) \},?\n", body):
        scope = re.sub(r"viaParent\('(\w+)', '(\w+)'\)", via, scope)
        scope = scope.replace("${", "").replace("}", "").strip("`'")
        out.append((name, scope))
    return out


@check("backup: EXPORT_TABLES covers every user table, parents before children")
def _():
    tables = [t for t, _ in export_tables()]
    db = fresh_db()
    real = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}
    # System tables are not part of a person's export: backups log, schema version, and setup values
    # (app_config, AUTH-07), which belong to the deployment, not to one user's study data.
    expected = {t for t in real if not t.startswith("passages_fts")} - {"backups", "schema_meta", "app_config"}
    assert set(tables) == expected, f"missing: {sorted(expected - set(tables))}; extra: {sorted(set(tables) - expected)}"
    pos = {t: i for i, t in enumerate(tables)}
    for t in tables:
        for row in db.execute(f"PRAGMA foreign_key_list({t})").fetchall():
            parent = row[2]
            if parent != t:
                assert pos[parent] < pos[t], f"{t} is listed before its parent {parent}"


def seed_everything(db: sqlite3.Connection, uid: str, email: str) -> None:
    """A small synthetic library touching most tables, for the export/restore round trip. Test-only."""
    q = db.execute
    q("INSERT INTO users (id, email, created_at) VALUES (?, ?, 1)", (uid, email))
    q("INSERT INTO user_emails (email, user_id, created_at) VALUES (?, ?, 1)", (email, uid))
    q("INSERT INTO settings (user_id, updated_at) VALUES (?, 1)", (uid,))
    p = uid + "-"
    q("INSERT INTO courses (id, user_id, name, institution_name, created_at, updated_at) VALUES (?, ?, 'Course', 'School', 1, 1)", (p + "c", uid))
    q("INSERT INTO units (id, course_id, name, position) VALUES (?, ?, 'Unit', 0)", (p + "un", p + "c"))
    q("INSERT INTO topics (id, course_id, unit_id, name, position, created_at) VALUES (?, ?, ?, 'Topic', 0, 1)", (p + "t", p + "c", p + "un"))
    q("INSERT INTO tags (id, user_id, name) VALUES (?, ?, 'tag')", (p + "g", uid))
    for sid, alt in ((p + "s1", None), (p + "s2", None)):
        q("""INSERT INTO sources (id, user_id, course_id, title, kind, origin, privacy, alt_rendition_of, created_at, updated_at)
             VALUES (?, ?, ?, 'Source', 'pdf', 'upload', 'published', ?, 1, 1)""", (sid, uid, p + "c", alt))
    q("UPDATE sources SET alt_rendition_of = ? WHERE id = ?", (p + "s2", p + "s1"))
    q("INSERT INTO entity_tags (tag_id, entity_type, entity_id) VALUES (?, 'source', ?)", (p + "g", p + "s1"))
    q("INSERT INTO source_topics (source_id, topic_id) VALUES (?, ?)", (p + "s1", p + "t"))
    q("""INSERT INTO source_versions (id, source_id, version_no, content_hash, r2_key, mime, bytes, status, created_at)
         VALUES (?, ?, 1, 'h', 'k', 'application/pdf', 1, 'ready', 1)""", (p + "v", p + "s1"))
    q("""INSERT INTO locations (id, source_version_id, ordinal, kind, label, extraction, content_hash)
         VALUES (?, ?, 1, 'page', 'p. 1', 'text', 'h')""", (p + "l", p + "v"))
    q("""INSERT INTO passages (id, user_id, source_id, source_version_id, location_id, ordinal, text, content_hash, token_count, privacy, citeable)
         VALUES (?, ?, ?, ?, ?, 1, 'Bernoulli relates pressure and velocity', 'h', 5, 'published', 1)""", (p + "p", uid, p + "s1", p + "v", p + "l"))
    q("INSERT INTO generations (id, user_id, task, provider, model, prompt_version, effective_privacy, created_at) VALUES (?, ?, 'gen_cards', 'gemini', 'm', 'gen_cards@1', 'published', 1)", (p + "gen", uid))
    q("INSERT INTO cards (id, user_id, course_id, type, front_md, origin, generation_id, created_at, updated_at) VALUES (?, ?, ?, 'basic', 'Q', 'ai', ?, 1, 1)", (p + "k", uid, p + "c", p + "gen"))
    q("INSERT INTO card_topics (card_id, topic_id) VALUES (?, ?)", (p + "k", p + "t"))
    q("INSERT INTO card_sources (card_id, passage_id, quote) VALUES (?, ?, 'Bernoulli relates')", (p + "k", p + "p"))
    q("INSERT INTO card_states (card_id, user_id, state, due_at) VALUES (?, ?, 'new', 1)", (p + "k", uid))
    q("INSERT INTO plan_blocks (id, user_id, day, planned_minutes, focus_json, reason, created_at) VALUES (?, ?, '2027-01-01', 20, '{}', 'r', 1)", (p + "pb", uid))
    q("INSERT INTO study_sessions (id, user_id, plan_block_id, started_at) VALUES (?, ?, ?, 1)", (p + "ss", uid, p + "pb"))
    q("""INSERT INTO review_log (id, user_id, card_id, variant, rating, reviewed_at, state_before, scheduled_days, fsrs_version, params_hash, session_id, client_id)
         VALUES (?, ?, ?, 'main', 3, 1, 'new', 1, 'fsrs-6', 'p', ?, ?)""", (p + "r", uid, p + "k", p + "ss", p + "client"))
    q("INSERT INTO source_change_flags (id, user_id, item_type, item_id, old_passage_id, change, created_at) VALUES (?, ?, 'card', ?, ?, 'removed', 1)", (p + "f", uid, p + "k", p + "p"))
    q("INSERT INTO conversations (id, user_id, course_id, title, mode, created_at, updated_at) VALUES (?, ?, ?, 'Chat', 'direct', 1, 1)", (p + "cv", uid, p + "c"))
    q("INSERT INTO messages (id, conversation_id, role, content_md, created_at) VALUES (?, ?, 'assistant', 'A', 1)", (p + "m", p + "cv"))
    q("INSERT INTO message_citations (id, message_id, passage_id, quote, verified) VALUES (?, ?, ?, 'Bernoulli relates', 1)", (p + "mc", p + "m", p + "p"))
    q("INSERT INTO questions (id, user_id, format, stem_md, payload_json, origin, created_at) VALUES (?, ?, 'tf', 'S', '{}', 'manual', 1)", (p + "q", uid))
    q("INSERT INTO quizzes (id, user_id, kind, title, config_json, created_at) VALUES (?, ?, 'quiz', 'Q', '{}', 1)", (p + "qz", uid))
    q("INSERT INTO quiz_items (quiz_id, position, question_id) VALUES (?, 0, ?)", (p + "qz", p + "q"))
    q("INSERT INTO attempts (id, user_id, question_id, quiz_id, response_json, final_score, answered_at, client_id) VALUES (?, ?, ?, ?, '{}', 1, 1, ?)", (p + "a", uid, p + "q", p + "qz", p + "ac"))
    q("INSERT INTO mastery (user_id, topic_id, updated_at) VALUES (?, ?, 1)", (uid, p + "t"))
    q("INSERT INTO deadlines (id, user_id, course_id, title, kind, due_at, origin, created_at) VALUES (?, ?, ?, 'Exam', 'exam', 1, 'manual', 1)", (p + "d", uid, p + "c"))
    q("INSERT INTO deadline_topics (deadline_id, topic_id) VALUES (?, ?)", (p + "d", p + "t"))


@check("backup: export scopes select only this user's rows, and export -> restore round-trips")
def _():
    tables = export_tables()
    src = fresh_db()
    seed_everything(src, "alex", "alex@example.com")
    seed_everything(src, "other", "other@example.com")  # must NOT leak into Alex's export
    exported: dict[str, tuple[list[str], list[tuple]]] = {}
    for name, scope in tables:
        cur = src.execute(f"SELECT * FROM {name} WHERE {scope}", ("alex",))
        cols = [c[0] for c in cur.description]
        rows = cur.fetchall()
        exported[name] = (cols, rows)
        for row in rows:
            assert "other" not in json_dump(row), f"{name}: another user's row leaked into the export: {row}"
    assert exported["passages"][1] and exported["message_citations"][1] and exported["deadline_topics"][1]

    dst = fresh_db()
    deferred = {"sources": ["alt_rendition_of"]}
    updates = []
    for name, _ in tables:  # restore in list order, as planRestore does
        cols, rows = exported[name]
        for row in rows:
            values = list(row)
            for col in deferred.get(name, []):
                i = cols.index(col)
                if values[i] is not None:
                    updates.append((name, col, values[i], values[cols.index("id")]))
                values[i] = None
            dst.execute(f"INSERT INTO {name} ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})", values)
    for name, col, value, rid in updates:
        dst.execute(f"UPDATE {name} SET {col} = ? WHERE id = ?", (value, rid))
    dst.execute("INSERT INTO passages_fts(passages_fts) VALUES ('rebuild')")
    for name, scope in tables:
        a = sorted(src.execute(f"SELECT * FROM {name} WHERE {scope}", ("alex",)).fetchall(), key=repr)
        b = sorted(dst.execute(f"SELECT * FROM {name} WHERE {scope}", ("alex",)).fetchall(), key=repr)
        assert a == b, f"{name} differs after restore"
    hit = dst.execute("SELECT rowid FROM passages_fts WHERE passages_fts MATCH 'bernoulli'").fetchall()
    assert len(hit) == 1, "FTS index not rebuilt"
    assert dst.execute("PRAGMA foreign_key_check").fetchall() == []


@check("search: the quoted-OR query format from src/shared/retrieval.ts works in FTS5, incl. hostile input")
def _():
    db = fresh_db()
    seed_minimal(db)
    ins = """INSERT INTO passages (id, user_id, source_id, source_version_id, location_id, ordinal, text, content_hash,
             token_count, privacy, citeable) VALUES (?, 'u1', 's1', 'v1', 'l1', ?, ?, 'h', 5, 'published', 1)"""
    db.execute(ins, ("p1", 1, "Entropy production in irreversible processes"))
    db.execute(ins, ("p2", 2, "Heat engines and the Carnot efficiency"))
    q = lambda s: [r[0] for r in db.execute(  # noqa: E731
        "SELECT p.id FROM passages_fts JOIN passages p ON p.rowid = passages_fts.rowid WHERE passages_fts MATCH ? ORDER BY bm25(passages_fts), p.id", (s,))]
    assert q('"entropy" OR "carnot"') == ["p1", "p2"] or q('"entropy" OR "carnot"') == ["p2", "p1"]
    assert q('"heat" OR "nothinglikethis"') == ["p2"]
    # Hostile-looking terms are just words once quoted (ftsQuery keeps only letters/digits and doubles quotes).
    assert q('"near" OR "text" OR "and"') == ["p2"], "quoted keywords are plain terms"


@check("courses: the Worker's home-school upsert, insert, duplicate check and delete SQL all run (INS-01/02)")
def _():
    src = (ROOT / "src" / "worker" / "courses.ts").read_text(encoding="utf-8")
    sqls = re.findall(r"`((?:INSERT|SELECT|UPDATE|DELETE)[^`]*)`", src, re.S)
    upsert = next(s for s in sqls if s.startswith("INSERT INTO settings"))
    insert = next(s for s in sqls if s.startswith("INSERT INTO courses"))
    dup = next(s for s in sqls if "COALESCE(institution_unitid" in s)
    db = fresh_db()
    db.execute("INSERT INTO users (id, email, created_at) VALUES ('u1', 'ci@studypoint.invalid', 1)")
    db.execute(upsert, ("u1", "163268", "Example University", "example.edu", 5))
    db.execute(upsert, ("u1", None, "Other College", None, 6))
    assert db.execute("SELECT home_unitid, home_institution_name FROM settings").fetchall() == [(None, "Other College")]
    db.execute(insert, ("c1", "u1", "college", "General Chemistry", "163268", "Example University", "example.edu", "CHEM", "101", "General Chemistry", 1, 1))
    db.execute(insert, ("c2", "u1", "personal", "Astronomy", None, "", None, None, None, None, 1, 1))  # LIB-01b
    assert db.execute(dup, ("u1", "CHEM", "101", "163268", "Example University")).fetchone() is not None
    assert db.execute(dup, ("u1", "CHEM", "101", None, "Another School")).fetchone() is None, "same code at another school is fine"
    db.execute("INSERT INTO topics (id, course_id, name, position, created_at) VALUES ('t1', 'c1', 'Topic', 0, 1)")
    db.execute("DELETE FROM courses WHERE id = ? AND user_id = ?", ("c1", "u1"))
    assert db.execute("SELECT COUNT(*) FROM topics").fetchone()[0] == 0, "topics go with the course"


@check("settings: the Worker's upsert SQL runs and updates in place (T0.20)")
def _():
    src = (ROOT / "src" / "worker" / "settings.ts").read_text(encoding="utf-8")
    sql = re.search(r"`(INSERT INTO settings.*?)`", src, re.S).group(1)
    db = fresh_db()
    db.execute("INSERT INTO users (id, email, created_at) VALUES ('u1', 'ci@studypoint.invalid', 1)")
    db.execute(sql, ("u1", "lab", "dark", '{"sizePct":120}', 5))
    db.execute(sql, ("u1", "midnight", "system", '{"sizePct":130}', 6))
    rows = db.execute("SELECT style, theme, reading_json, updated_at FROM settings").fetchall()
    assert rows == [("midnight", "system", '{"sizePct":130}', 6)], rows


@check("courses: kind defaults to 'college', allows 'personal' with no school or code, rejects others (0006)")
def _():
    db = fresh_db()
    db.execute("INSERT INTO users (id, email, created_at) VALUES ('u1', 'ci@studypoint.invalid', 1)")
    db.execute("INSERT INTO courses (id, user_id, name, institution_name, created_at, updated_at) VALUES ('c1', 'u1', 'Old', 'School', 1, 1)")
    assert db.execute("SELECT kind FROM courses WHERE id = 'c1'").fetchone() == ("college",)
    db.execute("INSERT INTO courses (id, user_id, kind, name, institution_name, created_at, updated_at) VALUES ('c2', 'u1', 'personal', 'Astronomy', '', 1, 1)")
    expect_error(db, "INSERT INTO courses (id, user_id, kind, name, institution_name, created_at, updated_at) VALUES ('c3', 'u1', 'hobby', 'x', '', 1, 1)", fragment="CHECK")


@check("worker SQL compiles against the schema (notes, vault, courses, settings, setup)")
def _():
    """EXPLAIN every SQL string in these Worker modules: catches table/column typos without D1."""
    db = fresh_db()
    checked = 0
    for name in ("notes.ts", "vault.ts", "files.ts", "cards.ts", "quizzes.ts", "conversations.ts", "aiIndex.ts", "ai/handlers.ts", "ai/gateway.ts", "courses.ts", "settings.ts", "setup/config.ts"):
        src = (ROOT / "src" / "worker" / name).read_text(encoding="utf-8")
        consts = {m.group(1): m.group(2) for m in re.finditer(r"const (\w+) = `([^`]*)`;", src, re.S)}
        for m in re.finditer(r"(['`])((?:SELECT|INSERT|UPDATE|DELETE)\b.*?)\1", src, re.S):
            sql = m.group(2)
            for k, v in consts.items():
                sql = sql.replace("${" + k + "}", v)
            if "${" in sql:
                continue  # dynamic column lists are covered by their own tests
            numbered = [int(n) for n in re.findall(r"\?(\d+)", sql)]
            params = max(numbered) if numbered else sql.count("?")
            try:
                db.execute("EXPLAIN " + sql, (None,) * params)
            except sqlite3.Error as e:
                raise AssertionError(f"{name}: {e}\n  {sql.strip()[:160]}")
            checked += 1
    assert checked >= 20, f"only {checked} statements found; the extractor may be broken"


def main() -> int:
    for ok, name, detail in results:
        print(f"{'PASS' if ok else 'FAIL'}: {name}" + (f"\n  {detail}" if detail else ""))
    failed = sum(1 for ok, _, _ in results if not ok)
    print(f"\nSchema tests: {len(results) - failed}/{len(results)} passed (SQLite {sqlite3.sqlite_version}).")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
