// Encrypted search indexes (step 5, A24). The browser builds one bundle per source (passages + vectors),
// encrypts it, and stores it here; the Worker can't read it. R2 key: index/<user>/<source>.

export class IndexError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'IndexError';
    this.status = status;
  }
}

export const MAX_INDEX_BYTES = 40 * 1024 * 1024;
export const indexKey = (userId: string, sourceId: string) => `index/${userId}/${sourceId}`;

export type IndexInfo = { sourceId: string; fingerprint: string; passages: number; embedModel: string; bytes: number; updatedAt: number };

export async function listIndexes(db: D1Database, userId: string, courseId: string | null): Promise<IndexInfo[]> {
  const base = `SELECT i.source_id, i.fingerprint, i.passages, i.embed_model, i.bytes, i.updated_at FROM source_index i
    JOIN sources s ON s.id = i.source_id WHERE i.user_id = ? AND s.deleted_at IS NULL`;
  const res = courseId
    ? await db.prepare(`${base} AND s.course_id = ?`).bind(userId, courseId).all<Record<string, unknown>>()
    : await db.prepare(base).bind(userId).all<Record<string, unknown>>();
  return res.results.map((r) => ({ sourceId: String(r['source_id']), fingerprint: String(r['fingerprint']), passages: Number(r['passages']), embedModel: String(r['embed_model']), bytes: Number(r['bytes']), updatedAt: Number(r['updated_at']) }));
}

export async function putIndex(db: D1Database, bucket: R2Bucket, userId: string, sourceId: string, body: Uint8Array, meta: { fingerprint: string; passages: number; embedModel: string }, now = Date.now()): Promise<void> {
  if (!(await db.prepare('SELECT id FROM sources WHERE id = ? AND user_id = ? AND deleted_at IS NULL').bind(sourceId, userId).first())) throw new IndexError(404, "That source doesn't exist.");
  if (body.length < 29 || body[0] !== 1) throw new IndexError(400, 'Indexes must be encrypted before they’re saved.');
  if (body.length > MAX_INDEX_BYTES) throw new IndexError(413, 'This index is too large.');
  if (!/^[0-9a-f]{64}$/.test(meta.fingerprint) || !Number.isInteger(meta.passages) || meta.passages < 0 || meta.passages > 100_000 || !meta.embedModel || meta.embedModel.length > 120) {
    throw new IndexError(400, 'Invalid index details.');
  }
  await bucket.put(indexKey(userId, sourceId), body, { httpMetadata: { contentType: 'application/octet-stream' } });
  await db.prepare(`INSERT INTO source_index (source_id, user_id, fingerprint, passages, embed_model, bytes, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
    ON CONFLICT(source_id) DO UPDATE SET fingerprint = ?3, passages = ?4, embed_model = ?5, bytes = ?6, updated_at = ?7`)
    .bind(sourceId, userId, meta.fingerprint, meta.passages, meta.embedModel, body.length, now).run();
}

export async function getIndex(db: D1Database, bucket: R2Bucket, userId: string, sourceId: string): Promise<R2ObjectBody> {
  if (!(await db.prepare('SELECT source_id FROM source_index WHERE source_id = ? AND user_id = ?').bind(sourceId, userId).first())) throw new IndexError(404, 'Not processed yet.');
  const obj = await bucket.get(indexKey(userId, sourceId));
  if (!obj) throw new IndexError(404, 'The processed copy is missing. Process the file again.');
  return obj;
}
