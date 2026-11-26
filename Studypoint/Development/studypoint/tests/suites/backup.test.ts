// EXP-01/02 tests (TESTING §2): document format, validation, restore planning, gzip, retention, user linking.

import {
  EXPORT_SCHEMA_VERSION, ExportFormatError, MAX_BOUND_PARAMS, buildExportDocument, gunzipJson, gzipJson,
  parseExportDocument, planRestore, type Row,
} from '../../src/worker/backup/format.ts';
import { EXPORT_TABLES } from '../../src/worker/backup/tables.ts';
import { backupKey, backupsToDelete } from '../../src/worker/backup/retention.ts';
import { resolveUser } from '../../src/worker/users.ts';

type TestFn = (name: string, fn: () => void | Promise<void>) => void;
type Assert = {
  ok(c: unknown, m?: string): void;
  equal(a: unknown, b: unknown, m?: string): void;
  deepEqual(a: unknown, b: unknown, m?: string): void;
  throws(fn: () => unknown, m?: string): void;
};

const user: Row = { id: 'u1', email: 'owner@example.com', display_name: null, created_at: 1 };

function doc(tables: Record<string, Row[]>) {
  return buildExportDocument({ users: [user], ...tables }, '0.1.0', new Date(Date.UTC(2027, 0, 2)));
}

function rejects(assert: Assert, input: unknown, fragment: string) {
  let err: unknown = null;
  try { parseExportDocument(input); } catch (e) { err = e; }
  assert.ok(err instanceof ExportFormatError, `expected ExportFormatError (${fragment})`);
  assert.ok(String((err as Error).message).toLowerCase().includes(fragment.toLowerCase()), `message should mention "${fragment}": ${(err as Error).message}`);
}

export function register(test: TestFn, assert: Assert): void {
  test('export: document lists every export table in restore order, with the format version', () => {
    const d = doc({});
    assert.equal(d.format, 'studypoint-export');
    assert.equal(d.export_schema_version, EXPORT_SCHEMA_VERSION);
    assert.deepEqual(Object.keys(d.tables), EXPORT_TABLES.map((t) => t.name));
    assert.equal(d.exported_at, '2027-01-02T00:00:00.000Z');
  });

  test('export: a valid document round-trips through JSON and validation', () => {
    const d = doc({ courses: [{ id: 'c1', user_id: 'u1', name: 'Course', institution_name: 'School', created_at: 1, updated_at: 1 }] });
    const parsed = parseExportDocument(JSON.parse(JSON.stringify(d)));
    assert.equal(parsed.tables['courses']?.length, 1);
  });

  test('import: malformed or hostile documents are rejected before touching the database', () => {
    const good = JSON.parse(JSON.stringify(doc({})));
    rejects(assert, null, 'not a studyflare');
    rejects(assert, { ...good, format: 'other' }, 'not a studyflare');
    rejects(assert, { ...good, export_schema_version: EXPORT_SCHEMA_VERSION + 1 }, 'newer studyflare');
    rejects(assert, { ...good, tables: { ...good.tables, evil: [] } }, 'unknown table');
    rejects(assert, { ...good, tables: { ...good.tables, courses: [{ 'id) VALUES (1); DROP TABLE users; --': 'x' }] } }, 'valid name');
    rejects(assert, { ...good, tables: { ...good.tables, courses: [{ id: { nested: true } }] } }, 'unsupported value');
    rejects(assert, { ...good, tables: { ...good.tables, users: [] } }, 'exactly one user');
    rejects(assert, { ...good, tables: { ...good.tables, users: [user, { ...user, id: 'u2' }] } }, 'exactly one user');
  });

  test('restore: every INSERT stays within D1 bound-parameter limit', () => {
    const rows: Row[] = Array.from({ length: 250 }, (_, i) => ({
      id: `p${i}`, user_id: 'u1', source_id: 's', source_version_id: 'v', location_id: 'l', ordinal: i, text: 't',
      content_hash: 'h', char_start: null, char_end: null, bbox_json: null, token_count: 1, privacy: 'published', citeable: 1,
      embedded_at: null, is_current: 1,
    }));
    const stmts = planRestore(doc({ passages: rows }));
    let inserted = 0;
    for (const s of stmts) {
      assert.ok(s.params.length <= MAX_BOUND_PARAMS, `${s.params.length} params in: ${s.sql.slice(0, 60)}`);
      const placeholders = (s.sql.match(/\?/g) ?? []).length;
      assert.equal(placeholders, s.params.length, 'placeholders must match params');
      if (s.sql.startsWith('INSERT INTO passages ')) inserted += s.params.length / 16;
    }
    assert.equal(inserted, 250);
  });

  test('restore: tables are inserted parents-first, and the FTS index is rebuilt last', () => {
    const stmts = planRestore(doc({
      courses: [{ id: 'c1', user_id: 'u1', name: 'C', institution_name: 'S', created_at: 1, updated_at: 1 }],
      topics: [{ id: 't1', course_id: 'c1', name: 'T', position: 0, created_at: 1 }],
    }));
    const order = stmts.map((s) => s.sql.split(' ')[2]);
    assert.ok(order.indexOf('users') < order.indexOf('courses') && order.indexOf('courses') < order.indexOf('topics'));
    assert.equal(stmts[stmts.length - 1]?.sql, "INSERT INTO passages_fts(passages_fts) VALUES ('rebuild')");
  });

  test('restore: self-references (sources.alt_rendition_of) are inserted as NULL, then set', () => {
    const base = { user_id: 'u1', kind: 'pdf', origin: 'upload', privacy: 'published', created_at: 1, updated_at: 1 };
    const stmts = planRestore(doc({
      sources: [
        { id: 's1', title: 'Deck PDF', alt_rendition_of: 's2', ...base },
        { id: 's2', title: 'Deck', alt_rendition_of: null, ...base },
      ],
    }));
    const insert = stmts.find((s) => s.sql.startsWith('INSERT INTO sources'));
    assert.ok(insert, 'insert present');
    const cols = insert?.sql.match(/\(([^)]*)\)/)?.[1]?.split(', ') ?? [];
    const altIdx = cols.indexOf('alt_rendition_of');
    assert.equal(insert?.params[altIdx], null, 'deferred column inserted as NULL');
    const update = stmts.find((s) => s.sql.startsWith('UPDATE sources'));
    assert.deepEqual(update?.params, ['s2', 's1']);
  });

  test('restore: rows with missing columns are filled with NULL', () => {
    const stmts = planRestore(doc({ tags: [{ id: 'g1', user_id: 'u1', name: 'a' }, { id: 'g2', user_id: 'u1', name: 'b' }] }));
    const s = stmts.find((x) => x.sql.startsWith('INSERT INTO tags'));
    assert.equal(s?.params.length, 6);
  });

  test('backup: gzip round-trip preserves the document', async () => {
    const d = doc({ tags: [{ id: 'g1', user_id: 'u1', name: 'Thermo ∑ ünïcode' }] });
    const bytes = await gzipJson(d);
    assert.equal(bytes[0], 0x1f);
    assert.equal(bytes[1], 0x8b);
    assert.deepEqual(await gunzipJson(bytes), JSON.parse(JSON.stringify(d)));
  });

  test('backup: keys are dated by UTC day', () => {
    assert.equal(backupKey(new Date(Date.UTC(2027, 2, 9, 23, 59)), 'u-1'), 'backups/u-1/2027-03-09.json.gz');
    assert.throws(() => backupKey(new Date(), '../etc'), 'user ids cannot escape the prefix');
  });

  test('backup retention: per account, keep the newest 30 dailies plus the first backup of each of the last 12 months', () => {
    const keys: string[] = [];
    for (let d = 0; d < 500; d += 1) keys.push(backupKey(new Date(Date.UTC(2026, 0, 1) + d * 86400000), 'alex'));
    for (let d = 0; d < 5; d += 1) keys.push(backupKey(new Date(Date.UTC(2026, 0, 1) + d * 86400000), 'friend'));
    keys.push('backups/notes.txt', 'other/2026-01-01.json.gz', 'backups/2026-01-01.json.gz');
    const del = new Set(backupsToDelete(keys));
    const kept = keys.filter((k) => !del.has(k));
    assert.ok(!del.has('backups/notes.txt') && !del.has('other/2026-01-01.json.gz') && !del.has('backups/2026-01-01.json.gz'), 'unrelated keys are never deleted');
    const newest = keys.slice(0, 500).slice(-30);
    for (const k of newest) assert.ok(!del.has(k), `newest daily kept: ${k}`);
    const monthlyKept = kept.filter((k) => k.startsWith('backups/alex/') && k.endsWith('-01.json.gz'));
    assert.ok(monthlyKept.length >= 12, `12 monthly backups kept, got ${monthlyKept.length}`);
    assert.ok(del.has('backups/alex/2026-01-01.json.gz'), 'month older than 12 months is dropped');
    for (let d = 0; d < 5; d += 1) assert.ok(!del.has(backupKey(new Date(Date.UTC(2026, 0, 1) + d * 86400000), 'friend')), "another account's recent backups are kept");
  });

  test('users (AUTH-03b): an OWNER email links to the existing owner account', () => {
    const owner = { id: 'owner', email: 'school@example.edu' };
    assert.deepEqual(resolveUser({ email: 'personal@example.com', via: 'access' }, null, owner, true), { action: 'link', userId: 'owner' });
    assert.deepEqual(resolveUser({ email: 'school@example.edu', via: 'access' }, owner, owner, true), { action: 'existing', userId: 'owner' });
    assert.deepEqual(resolveUser({ email: 'first@example.com', via: 'access' }, null, null, true), { action: 'create' });
  });

  test('users (AUTH-03b): an invited non-owner email gets its OWN account, never the owner\'s', () => {
    const owner = { id: 'owner', email: 'school@example.edu' };
    assert.deepEqual(resolveUser({ email: 'friend@example.com', via: 'access' }, null, owner, false), { action: 'create' });
    const friend = { id: 'friend', email: 'friend@example.com' };
    assert.deepEqual(resolveUser({ email: 'friend@example.com', via: 'access' }, friend, owner, false), { action: 'existing', userId: 'friend' });
  });

  test('users (AUTH-03b): CI and dev identities never join the owner account', () => {
    const owner = { id: 'owner', email: 'school@example.edu' };
    assert.deepEqual(resolveUser({ email: 'ci@studypoint.invalid', via: 'ci' }, null, owner, true), { action: 'create' });
    assert.deepEqual(resolveUser({ email: 'dev@example.com', via: 'dev' }, null, owner, true), { action: 'create' });
  });
}
