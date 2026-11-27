// LIB-08 + AUTH-08 notes storage: only ciphertext is accepted, notes are per account, edits from a stale
// copy are refused (409), and deleting is undo-able. The SQL itself is compiled against the real schema
// in tests/verify_schema.py.

import { decryptText, encryptText, importDataKey, randomBytes } from '../../src/shared/crypto/vault.ts';
import { uuid7 } from '../../src/shared/uuid7.ts';
import { NoteError, createNote, deleteNote, getNote, listNotes, restoreNote, updateNote } from '../../src/worker/notes.ts';

type TestFn = (name: string, fn: () => void | Promise<void>) => void;
type Assert = { ok(c: unknown, m?: string): void; equal(a: unknown, b: unknown, m?: string): void; deepEqual(a: unknown, b: unknown, m?: string): void };

type Src = { id: string; user_id: string; course_id: string | null; title: string; created_at: number; updated_at: number; deleted_at: number | null };

/** In-memory stand-in for the SQL in src/worker/notes.ts (matched by prefix). Unknown SQL throws. */
function fakeDb() {
  const sources = new Map<string, Src>();
  const bodies = new Map<string, string>();
  const courses = new Set(['u1:course-1']);
  const stmt = (sql: string, a: unknown[] = []) => ({
    bind: (...args: unknown[]) => stmt(sql, args),
    sql,
    a,
    async first() {
      if (sql.startsWith('SELECT id FROM courses')) return courses.has(`${a[1]}:${a[0]}`) ? { id: a[0] } : null;
      if (sql.startsWith('SELECT id FROM sources WHERE id')) return sources.has(a[0] as string) ? { id: a[0] } : null;
      if (sql.includes('JOIN notes n')) {
        const s = sources.get(a[0] as string);
        return s && s.user_id === a[1] && s.deleted_at === null ? { ...s, body_md: bodies.get(s.id) } : null;
      }
      throw new Error('unexpected first: ' + sql);
    },
    async all() {
      if (sql.includes("s.kind = 'note'")) {
        const list = [...sources.values()].filter((s) => s.user_id === a[0] && s.deleted_at === null && (a.length < 2 || s.course_id === a[1]));
        return { results: list.sort((x, y) => y.updated_at - x.updated_at) };
      }
      throw new Error('unexpected all: ' + sql);
    },
    async run() {
      if (sql.startsWith('UPDATE sources SET deleted_at = ?')) {
        const s = sources.get(a[1] as string);
        if (!s || s.user_id !== a[2] || s.deleted_at !== null) return { meta: { changes: 0 } };
        s.deleted_at = a[0] as number;
        return { meta: { changes: 1 } };
      }
      if (sql.startsWith('UPDATE sources SET deleted_at = NULL')) {
        const s = sources.get(a[0] as string);
        if (!s || s.user_id !== a[1] || s.deleted_at === null) return { meta: { changes: 0 } };
        s.deleted_at = null;
        return { meta: { changes: 1 } };
      }
      throw new Error('unexpected run: ' + sql);
    },
  });
  const db = {
    prepare: (sql: string) => stmt(sql),
    async batch(list: Array<{ sql: string; a: unknown[] }>) {
      for (const s of list) {
        const a = s.a;
        if (s.sql.startsWith('INSERT INTO sources')) {
          sources.set(a[0] as string, { id: a[0] as string, user_id: a[1] as string, course_id: a[2] as string | null, title: a[3] as string, created_at: a[4] as number, updated_at: a[5] as number, deleted_at: null });
        } else if (s.sql.startsWith('INSERT INTO notes')) bodies.set(a[0] as string, a[1] as string);
        else if (s.sql.startsWith('UPDATE sources SET title')) Object.assign(sources.get(a[3] as string) as Src, { title: a[0], course_id: a[1], updated_at: a[2] });
        else if (s.sql.startsWith('UPDATE notes SET body_md')) bodies.set(a[2] as string, a[0] as string);
        else throw new Error('unexpected batch: ' + s.sql);
      }
      return [];
    },
  } as unknown as D1Database;
  return { db, sources, bodies };
}

async function sealed(id: string, title: string, body: string) {
  const k = await importDataKey(randomBytes(32));
  return { k, title: await encryptText(k, title, `${id}#title`), body: await encryptText(k, body, `${id}#body`) };
}

async function status(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 0;
  } catch (e) {
    return e instanceof NoteError ? e.status : -1;
  }
}

export function register(test: TestFn, assert: Assert): void {
  test('notes: plaintext titles or bodies are refused; nothing is stored', async () => {
    const { db, sources } = fakeDb();
    const id = uuid7();
    const s = await sealed(id, 'Lecture 3', 'body');
    assert.equal(await status(createNote(db, 'u1', { id, title: 'Lecture 3', body: s.body })), 400);
    assert.equal(await status(createNote(db, 'u1', { id, title: s.title, body: '{"doc":"plain"}' })), 400);
    assert.equal(await status(createNote(db, 'u1', { id: 'not-a-uuid', title: s.title, body: s.body })), 400);
    assert.equal(sources.size, 0);
  });

  test('notes: create, list and open round-trip the ciphertext; decrypting gives the text back', async () => {
    const { db, bodies } = fakeDb();
    const id = uuid7();
    const s = await sealed(id, 'Thermo: first law', '{"format":"tiptap@1"}');
    await createNote(db, 'u1', { id, courseId: 'course-1', title: s.title, body: s.body }, 100);
    assert.ok(!(bodies.get(id) ?? '').includes('tiptap'), 'stored body is ciphertext');
    const list = await listNotes(db, 'u1');
    assert.equal(list.length, 1);
    assert.equal(await decryptText(s.k, list[0]?.title ?? '', `${id}#title`), 'Thermo: first law');
    const note = await getNote(db, 'u1', id);
    assert.equal(await decryptText(s.k, note?.body ?? '', `${id}#body`), '{"format":"tiptap@1"}');
    assert.equal((await listNotes(db, 'u1', 'course-1')).length, 1);
    assert.equal((await listNotes(db, 'u1', 'other')).length, 0);
  });

  test('notes: another account can neither see, open, edit nor delete them', async () => {
    const { db } = fakeDb();
    const id = uuid7();
    const s = await sealed(id, 't', 'b');
    await createNote(db, 'u1', { id, title: s.title, body: s.body }, 100);
    assert.equal((await listNotes(db, 'u2')).length, 0);
    assert.equal(await getNote(db, 'u2', id), null);
    assert.equal(await status(updateNote(db, 'u2', id, { title: s.title, body: s.body, baseUpdatedAt: 100 })), 404);
    assert.ok(!(await deleteNote(db, 'u2', id)));
    assert.equal(await status(createNote(db, 'u2', { id, title: s.title, body: s.body })), 409, 'ids are global');
    assert.equal(await status(createNote(db, 'u1', { id: uuid7(), courseId: 'course-of-u2', title: s.title, body: s.body })), 404, "can't file into someone else's course");
  });

  test('notes: saving from a stale copy is refused (409); a fresh save moves updatedAt forward', async () => {
    const { db } = fakeDb();
    const id = uuid7();
    const s = await sealed(id, 't', 'b');
    await createNote(db, 'u1', { id, title: s.title, body: s.body }, 100);
    const saved = await updateNote(db, 'u1', id, { title: s.title, body: s.body, baseUpdatedAt: 100 }, 100);
    assert.ok(saved.updatedAt > 100, 'strictly increases even within the same millisecond');
    assert.equal(await status(updateNote(db, 'u1', id, { title: s.title, body: s.body, baseUpdatedAt: 100 }, 200)), 409);
    assert.equal(await status(updateNote(db, 'u1', id, { title: s.title, body: 'x'.repeat(1_500_000), baseUpdatedAt: saved.updatedAt })), 413);
  });

  test('notes: delete hides the note; restore brings it back', async () => {
    const { db } = fakeDb();
    const id = uuid7();
    const s = await sealed(id, 't', 'b');
    await createNote(db, 'u1', { id, title: s.title, body: s.body }, 100);
    assert.ok(await deleteNote(db, 'u1', id));
    assert.equal((await listNotes(db, 'u1')).length, 0);
    assert.equal(await getNote(db, 'u1', id), null);
    assert.ok(await restoreNote(db, 'u1', id));
    assert.equal((await listNotes(db, 'u1')).length, 1);
  });
}
