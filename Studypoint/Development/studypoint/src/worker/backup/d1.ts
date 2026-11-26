// Export, restore and nightly backup against D1 + R2 (EXP-01/02). Integration-tested in CI against real
// bindings; the document format and restore planning are unit-tested locally (format.ts, retention.ts).

import { CI_USER_EMAIL } from '../auth/policy.ts';
import { buildExportDocument, gzipJson, planRestore, type ExportDocument, type Row, type Statement } from './format.ts';
import { BACKUP_PREFIX, backupKey, backupsToDelete } from './retention.ts';
import { CONTENT_TABLES, EXPORT_TABLES } from './tables.ts';
import { EXPORT_SCHEMA_VERSION } from './format.ts';
import { uuid7 } from '../../shared/uuid7.ts';

/** D1 runs a batch as one transaction; very large restores are split into several batches. */
const STATEMENTS_PER_BATCH = 200;

export class RestoreRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RestoreRefused';
  }
}

export async function exportUserTables(db: D1Database, userId: string): Promise<Record<string, Row[]>> {
  const tables: Record<string, Row[]> = {};
  for (const t of EXPORT_TABLES) {
    const res = await db.prepare(`SELECT * FROM ${t.name} WHERE ${t.scope}`).bind(userId).all<Row>();
    tables[t.name] = res.results;
  }
  return tables;
}

export async function exportUser(db: D1Database, userId: string, appVersion: string, now = new Date()): Promise<ExportDocument> {
  return buildExportDocument(await exportUserTables(db, userId), appVersion, now);
}

export async function userHasContent(db: D1Database, userId: string): Promise<boolean> {
  for (const name of CONTENT_TABLES) {
    const t = EXPORT_TABLES.find((x) => x.name === name);
    if (!t) continue;
    const row = await db.prepare(`SELECT 1 AS present FROM ${t.name} WHERE ${t.scope} LIMIT 1`).bind(userId).first();
    if (row) return true;
  }
  return false;
}

/**
 * Restore an export into the signed-in user's EMPTY account (DATABASE §5: "restore goes into an empty
 * database only"). The current, empty user row is replaced by the exported one, and the login email is
 * linked to it. Re-embedding passages is queued by the caller.
 */
export async function restoreUser(db: D1Database, doc: ExportDocument, currentUserId: string, loginEmail: string, now = Date.now()): Promise<number> {
  if (await userHasContent(db, currentUserId)) {
    throw new RestoreRefused('Restore only works on an empty Studypoint. Export and clear your current data first.');
  }
  const docUser = doc.tables['users']?.[0];
  const docUserId = docUser?.['id'];
  if (typeof docUserId !== 'string') throw new RestoreRefused('The export has no user record.');

  const statements: Statement[] = [
    { sql: 'DELETE FROM users WHERE id = ?', params: [currentUserId] }, // cascades its settings and email links
    ...planRestore(doc),
    { sql: 'INSERT OR IGNORE INTO user_emails (email, user_id, created_at) VALUES (?, ?, ?)', params: [loginEmail.toLowerCase(), docUserId, now] },
  ];
  for (let i = 0; i < statements.length; i += STATEMENTS_PER_BATCH) {
    const chunk = statements.slice(i, i + STATEMENTS_PER_BATCH);
    await db.batch(chunk.map((s) => db.prepare(s.sql).bind(...s.params)));
  }
  return statements.length;
}

/** Nightly cron (EXP-02): back up the owner account to R2 and apply retention. */
export async function runNightlyBackup(db: D1Database, bucket: R2Bucket, appVersion: string, now = new Date()): Promise<string | null> {
  const owner = await db
    .prepare('SELECT id FROM users WHERE email <> ? ORDER BY created_at ASC, id ASC LIMIT 1')
    .bind(CI_USER_EMAIL)
    .first<{ id: string }>();
  if (!owner) return null; // nothing to back up yet (the app starts blank)

  const key = backupKey(now);
  const record = (status: 'ok' | 'failed', bytes: number | null, detail: string | null) =>
    db
      .prepare('INSERT INTO backups (id, r2_key, bytes, schema_version, status, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(uuid7(now.getTime()), key, bytes, EXPORT_SCHEMA_VERSION, status, detail, now.getTime())
      .run();
  try {
    const body = await gzipJson(await exportUser(db, owner.id, appVersion, now));
    await bucket.put(key, body, { httpMetadata: { contentType: 'application/gzip' } });
    await record('ok', body.byteLength, null);
  } catch (err) {
    await record('failed', null, err instanceof Error ? err.message.slice(0, 500) : 'unknown error');
    throw err;
  }

  const listed = await bucket.list({ prefix: BACKUP_PREFIX });
  const stale = backupsToDelete(listed.objects.map((o) => o.key));
  if (stale.length > 0) await bucket.delete(stale);
  return key;
}
