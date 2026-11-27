// LIB-02 / LIB-11 / AUTH-08 upload flow in the Worker: metadata checks, duplicates, chunk rules, completion
// and per-account isolation. The SQL itself is compiled against the schema in tests/verify_schema.py.

import { BYTES_OVERHEAD, encryptText, importDataKey, randomBytes } from '../../src/shared/crypto/vault.ts';
import { CHUNK_BYTES } from '../../src/shared/fileSniff.ts';
import { uuid7 } from '../../src/shared/uuid7.ts';
import { FileError, completeUpload, createUpload, deleteFile, getChunk, getFile, listFiles, putChunk } from '../../src/worker/files.ts';

type TestFn = (name: string, fn: () => void | Promise<void>) => void;
type Assert = { ok(c: unknown, m?: string): void; equal(a: unknown, b: unknown, m?: string): void; deepEqual(a: unknown, b: unknown, m?: string): void };

type Src = { id: string; user_id: string; course_id: string; title: string; kind: string; origin: string; current_version_id: string; created_at: number; deleted_at: number | null };
type Ver = { id: string; source_id: string; content_hash: string; mime: string; bytes: number; status: string };

function fakes() {
  const sources = new Map<string, Src>();
  const versions = new Map<string, Ver>();
  const objects = new Map<string, Uint8Array>();
  const courses = new Set(['u1:c1', 'u2:c2']);
  const joined = (userId: unknown) => [...sources.values()].filter((s) => s.user_id === userId && s.deleted_at === null).map((s) => {
    const v = versions.get(s.current_version_id) as Ver;
    return { id: s.id, version_id: v.id, course_id: s.course_id, kind: s.kind, mime: v.mime, bytes: v.bytes, title: s.title, status: v.status, origin: s.origin, created_at: s.created_at };
  });
  const stmt = (sql: string, a: unknown[] = []) => ({
    sql, a,
    bind: (...args: unknown[]) => stmt(sql, args),
    async first() {
      if (sql.startsWith('SELECT id FROM courses')) return courses.has(`${a[1]}:${a[0]}`) ? { id: a[0] } : null;
      if (sql.includes('v.content_hash = ?')) {
        const hit = [...versions.values()].find((v) => v.content_hash === a[1] && sources.get(v.source_id)?.user_id === a[0] && sources.get(v.source_id)?.deleted_at === null);
        return hit ? { id: hit.source_id } : null;
      }
      if (sql.startsWith('SELECT v.status, v.bytes')) {
        const v = versions.get(a[0] as string);
        const s = v ? sources.get(v.source_id) : undefined;
        return v && s && s.user_id === a[1] && s.deleted_at === null ? { status: v.status, bytes: v.bytes } : null;
      }
      if (sql.includes('AND s.id = ?')) return joined(a[0]).find((r) => r.id === a[1]) ?? null;
      throw new Error('unexpected first: ' + sql);
    },
    async all() {
      if (sql.includes("s.origin IN ('upload','lookup_url')")) return { results: joined(a[0]).filter((r) => a.length < 2 || r.course_id === a[1]) };
      throw new Error('unexpected all: ' + sql);
    },
    async run() {
      if (sql.startsWith("UPDATE source_versions SET status = 'ready'")) {
        (versions.get(a[1] as string) as Ver).status = 'ready';
        return { meta: { changes: 1 } };
      }
      if (sql.startsWith('UPDATE sources SET deleted_at = ?')) {
        const s = sources.get(a[1] as string);
        if (!s || s.user_id !== a[2] || s.deleted_at !== null) return { meta: { changes: 0 } };
        s.deleted_at = a[0] as number;
        return { meta: { changes: 1 } };
      }
      throw new Error('unexpected run: ' + sql);
    },
  });
  const db = {
    prepare: (sql: string) => stmt(sql),
    async batch(list: Array<{ sql: string; a: unknown[] }>) {
      for (const { sql, a } of list) {
        if (sql.startsWith('INSERT INTO sources')) sources.set(a[0] as string, { id: a[0] as string, user_id: a[1] as string, course_id: a[2] as string, title: a[3] as string, kind: a[4] as string, origin: a[5] as string, current_version_id: a[6] as string, created_at: a[7] as number, deleted_at: null });
        else if (sql.startsWith('INSERT INTO source_versions')) versions.set(a[0] as string, { id: a[0] as string, source_id: a[1] as string, content_hash: a[2] as string, mime: a[4] as string, bytes: a[5] as number, status: 'uploading' });
        else throw new Error('unexpected batch: ' + sql);
      }
      return [];
    },
  } as unknown as D1Database;
  const bucket = {
    async put(key: string, body: Uint8Array) { objects.set(key, body); return {}; },
    async get(key: string) { const b = objects.get(key); return b ? { body: b } : null; },
    async list({ prefix }: { prefix: string }) { return { objects: [...objects.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })), truncated: false }; },
  } as unknown as R2Bucket;
  return { db, bucket, objects, sources };
}

async function meta(over: Record<string, unknown> = {}) {
  const sourceId = uuid7();
  const k = await importDataKey(randomBytes(32));
  return {
    sourceId, versionId: uuid7(), courseId: 'c1', kind: 'pdf', mime: 'application/pdf', bytes: CHUNK_BYTES + 10,
    contentHash: 'a'.repeat(64), title: await encryptText(k, 'Week 3', `${sourceId}#title`), ...over,
  };
}

const sealedChunk = (plainLen: number) => {
  const b = new Uint8Array(plainLen + BYTES_OVERHEAD);
  b[0] = 1;
  return b;
};

async function status(p: Promise<unknown>): Promise<number> {
  try { await p; return 0; } catch (e) { return e instanceof FileError ? e.status : -1; }
}

export function register(test: TestFn, assert: Assert): void {
  test('files: metadata is checked: encrypted title, known type with matching MIME, size limit, own course', async () => {
    const { db } = fakes();
    assert.equal(await status(createUpload(db, 'u1', await meta({ title: 'Week 3' }))), 400, 'plaintext title');
    assert.equal(await status(createUpload(db, 'u1', await meta({ kind: 'pdf', mime: 'image/png' }))), 400, 'MIME must match kind');
    assert.equal(await status(createUpload(db, 'u1', await meta({ kind: 'svg', mime: 'image/svg+xml' }))), 400, 'SVG never');
    assert.equal(await status(createUpload(db, 'u1', await meta({ bytes: 101 * 1024 * 1024 }))), 413);
    assert.equal(await status(createUpload(db, 'u1', await meta({ courseId: 'c2' }))), 400, "someone else's course");
    assert.equal(await status(createUpload(db, 'u1', await meta({ courseId: null }))), 400, 'a course is required');
  });

  test('files: full upload: chunks of the exact sealed size, then complete → ready and listed', async () => {
    const { db, bucket } = fakes();
    const m = await meta();
    await createUpload(db, 'u1', m);
    assert.equal((await listFiles(db, 'u1'))[0]?.status, 'uploading');
    assert.equal(await status(putChunk(db, bucket, 'u1', m.versionId, 0, sealedChunk(100))), 400, 'wrong size');
    assert.equal(await status(putChunk(db, bucket, 'u1', m.versionId, 2, sealedChunk(10))), 400, 'index out of range');
    assert.equal(await status(putChunk(db, bucket, 'u2', m.versionId, 0, sealedChunk(CHUNK_BYTES))), 404, 'another account');
    await putChunk(db, bucket, 'u1', m.versionId, 0, sealedChunk(CHUNK_BYTES));
    assert.equal(await status(completeUpload(db, bucket, 'u1', m.versionId)), 409, 'last chunk missing');
    await putChunk(db, bucket, 'u1', m.versionId, 1, sealedChunk(10));
    await completeUpload(db, bucket, 'u1', m.versionId);
    const f = await getFile(db, 'u1', m.sourceId);
    assert.equal(f?.status, 'ready');
    assert.equal(f?.chunks, 2);
    assert.equal(await status(putChunk(db, bucket, 'u1', m.versionId, 1, sealedChunk(10))), 409, 'no writes after completion');
    assert.ok(await getChunk(db, bucket, 'u1', m.versionId, 1));
    assert.equal(await status(getChunk(db, bucket, 'u2', m.versionId, 1)), 404);
  });

  test('files (link import): imported pages are stored as origin lookup_url and listed as from a link', async () => {
    const { db, sources } = fakes();
    const m = await meta({ origin: 'link', kind: 'md', mime: 'text/markdown', bytes: 2000, contentHash: 'b'.repeat(64) });
    const f = await createUpload(db, 'u1', m);
    assert.equal(f.origin, 'link');
    assert.equal(sources.get(m.sourceId)?.origin, 'lookup_url');
    assert.equal((await listFiles(db, 'u1'))[0]?.origin, 'link');
  });

  test('files: the same file (same fingerprint) is refused as a duplicate, until the first is deleted', async () => {
    const { db } = fakes();
    const first = await meta();
    await createUpload(db, 'u1', first);
    const again = await meta();
    let existing: string | null = null;
    try { await createUpload(db, 'u1', again); } catch (e) { existing = e instanceof FileError ? e.existingId : null; }
    assert.equal(existing, first.sourceId);
    assert.equal(await status(createUpload(db, 'u2', await meta({ courseId: 'c2' }))), 0, 'another account may have the same file');
    assert.ok(await deleteFile(db, 'u1', first.sourceId));
    assert.equal(await status(createUpload(db, 'u1', await meta())), 0, 'allowed again after deleting');
  });
}
