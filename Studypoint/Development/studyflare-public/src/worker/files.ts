// Uploaded files (LIB-02, LIB-11, AUTH-08). The browser checks the file type, then encrypts it in 4 MiB
// chunks; the Worker only ever stores ciphertext: a `sources` row (title encrypted), a `source_versions`
// row and one R2 object per chunk at files/<user>/<version>/<n>.
//
// Flow: POST /api/files (metadata, duplicate check) → PUT each chunk → POST …/complete (all chunks
// present → status 'ready'). An upload that never completes stays 'uploading' and can be deleted.

import { isEnvelope, BYTES_OVERHEAD } from '../shared/crypto/vault.ts';
import { CHUNK_BYTES, KIND_MIME, chunkCount, type FileKind } from '../shared/fileSniff.ts';
import { isUuid7 } from '../shared/uuid7.ts';

export class FileError extends Error {
  readonly status: number;
  readonly existingId: string | null;
  constructor(status: number, message: string, existingId: string | null = null) {
    super(message);
    this.name = 'FileError';
    this.status = status;
    this.existingId = existingId;
  }
}

export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const FILE_KINDS: readonly FileKind[] = ['pdf', 'docx', 'pptx', 'image', 'md'];

export type FileInfo = {
  id: string;
  versionId: string;
  courseId: string | null;
  kind: FileKind;
  mime: string;
  bytes: number;
  chunks: number;
  title: string;
  status: 'uploading' | 'ready';
  /**
   * 'link' = imported from a web address (sources.origin 'lookup_url'); the address is inside the encrypted file.
   * 'ai' = made by Studyflare's AI (study guides, diagrams; origin 'ai_primer', never cited, LKP-04).
   */
  origin: 'upload' | 'link' | 'ai';
  createdAt: number;
};

type Row = {
  id: string; version_id: string; course_id: string | null; kind: FileKind; mime: string; bytes: number;
  title: string; status: string; origin: string; created_at: number;
};

const info = (r: Row): FileInfo => ({
  id: r.id, versionId: r.version_id, courseId: r.course_id, kind: r.kind, mime: r.mime, bytes: r.bytes,
  chunks: chunkCount(r.bytes), title: r.title, status: r.status === 'ready' ? 'ready' : 'uploading',
  origin: r.origin === 'lookup_url' ? 'link' : r.origin === 'ai_primer' ? 'ai' : 'upload', createdAt: r.created_at,
});

const SELECT = `SELECT s.id, v.id AS version_id, s.course_id, s.kind, v.mime, v.bytes, s.title, v.status, s.origin, s.created_at
  FROM sources s JOIN source_versions v ON v.id = s.current_version_id
  WHERE s.user_id = ? AND s.kind IN ('pdf','docx','pptx','image','md') AND s.origin IN ('upload','lookup_url','ai_primer') AND s.deleted_at IS NULL`;

export const chunkKey = (userId: string, versionId: string, n: number) => `files/${userId}/${versionId}/${n}`;

export async function listFiles(db: D1Database, userId: string, courseId?: string | null): Promise<FileInfo[]> {
  const res = courseId
    ? await db.prepare(`${SELECT} AND s.course_id = ? ORDER BY s.created_at DESC`).bind(userId, courseId).all<Row>()
    : await db.prepare(`${SELECT} ORDER BY s.created_at DESC`).bind(userId).all<Row>();
  return res.results.map(info);
}

export async function getFile(db: D1Database, userId: string, id: string): Promise<FileInfo | null> {
  const r = await db.prepare(`${SELECT} AND s.id = ?`).bind(userId, id).first<Row>();
  return r ? info(r) : null;
}

async function versionFor(db: D1Database, userId: string, versionId: string): Promise<{ status: string; bytes: number } | null> {
  return db.prepare(`SELECT v.status, v.bytes FROM source_versions v JOIN sources s ON s.id = v.source_id
    WHERE v.id = ? AND s.user_id = ? AND s.deleted_at IS NULL`).bind(versionId, userId).first<{ status: string; bytes: number }>();
}

export async function createUpload(db: D1Database, userId: string, input: unknown, now = Date.now()): Promise<FileInfo> {
  const b = (input ?? {}) as Record<string, unknown>;
  const { sourceId, versionId, courseId, kind, mime, bytes, contentHash, title } = b;
  if (typeof sourceId !== 'string' || !isUuid7(sourceId) || typeof versionId !== 'string' || !isUuid7(versionId)) throw new FileError(400, 'Invalid file id.');
  if (typeof kind !== 'string' || !(FILE_KINDS as readonly string[]).includes(kind) || typeof mime !== 'string' || KIND_MIME[mime] !== kind) {
    throw new FileError(400, 'That file type isn’t supported.');
  }
  if (typeof bytes !== 'number' || !Number.isInteger(bytes) || bytes < 1 || bytes > MAX_FILE_BYTES) throw new FileError(413, 'Files can be up to 100 MB.');
  if (typeof contentHash !== 'string' || !/^[0-9a-f]{64}$/.test(contentHash)) throw new FileError(400, 'Invalid file fingerprint.');
  if (!isEnvelope(title)) throw new FileError(400, 'The file name must be encrypted before it’s saved.');
  if (typeof courseId !== 'string' || !(await db.prepare('SELECT id FROM courses WHERE id = ? AND user_id = ?').bind(courseId, userId).first())) {
    throw new FileError(400, 'Choose a course for this file first.');
  }
  const dup = await db.prepare(`SELECT s.id FROM source_versions v JOIN sources s ON s.id = v.source_id
    WHERE s.user_id = ? AND v.content_hash = ? AND s.deleted_at IS NULL LIMIT 1`).bind(userId, contentHash).first<{ id: string }>();
  if (dup) throw new FileError(409, 'This file is already in your library.', dup.id);
  const origin = b['origin'] === 'link' ? 'lookup_url' : b['origin'] === 'ai' ? 'ai_primer' : 'upload';
  if (origin === 'ai_primer' && kind !== 'md') throw new FileError(400, 'AI-made materials are Markdown.');
  await db.batch([
    db.prepare(`INSERT INTO sources (id, user_id, course_id, title, kind, origin, privacy, citeable, current_version_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'personal', ?, ?, ?, ?)`).bind(sourceId, userId, courseId, title, kind, origin, origin === 'ai_primer' ? 0 : 1, versionId, now, now),
    db.prepare(`INSERT INTO source_versions (id, source_id, version_no, content_hash, r2_key, mime, bytes, status, created_at)
      VALUES (?, ?, 1, ?, ?, ?, ?, 'uploading', ?)`).bind(versionId, sourceId, contentHash, `files/${userId}/${versionId}`, mime, bytes, now),
  ]);
  return { id: sourceId, versionId, courseId, kind: kind as FileKind, mime, bytes, chunks: chunkCount(bytes), title: title as string, status: 'uploading', origin: origin === 'lookup_url' ? 'link' : origin === 'ai_primer' ? 'ai' : 'upload', createdAt: now };
}

/** Store one encrypted chunk. Only while the upload is open, only valid indexes, only sealed-looking bytes. */
export async function putChunk(db: D1Database, bucket: R2Bucket, userId: string, versionId: string, n: number, body: Uint8Array): Promise<void> {
  const v = await versionFor(db, userId, versionId);
  if (!v) throw new FileError(404, "That upload doesn't exist.");
  if (v.status !== 'uploading') throw new FileError(409, 'This upload is already finished.');
  const total = chunkCount(v.bytes);
  if (!Number.isInteger(n) || n < 0 || n >= total) throw new FileError(400, 'Invalid chunk number.');
  const expected = (n === total - 1 ? v.bytes - CHUNK_BYTES * (total - 1) : CHUNK_BYTES) + BYTES_OVERHEAD;
  if (body.length !== expected || body[0] !== 1) throw new FileError(400, 'That chunk is the wrong size or isn’t encrypted.');
  await bucket.put(chunkKey(userId, versionId, n), body, { httpMetadata: { contentType: 'application/octet-stream' } });
}

export async function completeUpload(db: D1Database, bucket: R2Bucket, userId: string, versionId: string, now = Date.now()): Promise<void> {
  const v = await versionFor(db, userId, versionId);
  if (!v) throw new FileError(404, "That upload doesn't exist.");
  if (v.status === 'ready') return;
  const total = chunkCount(v.bytes);
  const have = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: `files/${userId}/${versionId}/`, cursor });
    for (const o of page.objects) have.add(o.key);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  for (let n = 0; n < total; n += 1) if (!have.has(chunkKey(userId, versionId, n))) throw new FileError(409, `Part ${n + 1} of ${total} is missing. Try the upload again.`);
  await db.prepare("UPDATE source_versions SET status = 'ready', ready_at = ? WHERE id = ?").bind(now, versionId).run();
}

export async function getChunk(db: D1Database, bucket: R2Bucket, userId: string, versionId: string, n: number): Promise<R2ObjectBody> {
  const v = await versionFor(db, userId, versionId);
  if (!v || v.status !== 'ready') throw new FileError(404, "That file isn't available.");
  if (!Number.isInteger(n) || n < 0 || n >= chunkCount(v.bytes)) throw new FileError(400, 'Invalid chunk number.');
  const obj = await bucket.get(chunkKey(userId, versionId, n));
  if (!obj) throw new FileError(404, 'Part of this file is missing from storage.');
  return obj;
}

/** Soft delete: the file disappears from the Library and can be restored. Storage is cleaned up later. */
export async function deleteFile(db: D1Database, userId: string, id: string, now = Date.now()): Promise<boolean> {
  const res = await db.prepare("UPDATE sources SET deleted_at = ? WHERE id = ? AND user_id = ? AND origin IN ('upload','lookup_url','ai_primer') AND deleted_at IS NULL").bind(now, id, userId).run();
  return (res.meta.changes ?? 0) > 0;
}

export async function restoreFile(db: D1Database, userId: string, id: string): Promise<boolean> {
  const res = await db.prepare("UPDATE sources SET deleted_at = NULL WHERE id = ? AND user_id = ? AND origin IN ('upload','lookup_url','ai_primer') AND deleted_at IS NOT NULL").bind(id, userId).run();
  return (res.meta.changes ?? 0) > 0;
}
