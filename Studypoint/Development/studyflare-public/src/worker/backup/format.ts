// Export / backup document format (EXP-01/02, DATABASE §5). Pure: no bindings.
// The same document is used for the manual export, the nightly backup and restore.

import { DEFERRED_COLUMNS, EXPORT_TABLES } from './tables.ts';

export const EXPORT_SCHEMA_VERSION = 1;
/** D1 allows at most 100 bound parameters per statement. */
export const MAX_BOUND_PARAMS = 100;

export type Row = Record<string, string | number | null>;

export type ExportDocument = {
  format: 'studypoint-export';
  export_schema_version: number;
  exported_at: string;
  app_version: string;
  tables: Record<string, Row[]>;
};

export class ExportFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportFormatError';
  }
}

export function buildExportDocument(tables: Record<string, Row[]>, appVersion: string, now: Date = new Date()): ExportDocument {
  const ordered: Record<string, Row[]> = {};
  for (const t of EXPORT_TABLES) ordered[t.name] = tables[t.name] ?? [];
  return {
    format: 'studypoint-export',
    export_schema_version: EXPORT_SCHEMA_VERSION,
    exported_at: now.toISOString(),
    app_version: appVersion,
    tables: ordered,
  };
}

const KNOWN = new Set(EXPORT_TABLES.map((t) => t.name));
const IDENT = /^[a-z_][a-z0-9_]*$/;

/**
 * Check an uploaded document before anything touches the database.
 * Older export versions get upgrade functions here when the format changes (none yet).
 */
export function parseExportDocument(input: unknown): ExportDocument {
  if (typeof input !== 'object' || input === null) throw new ExportFormatError('Not a Studyflare export file.');
  const doc = input as Record<string, unknown>;
  if (doc['format'] !== 'studypoint-export') throw new ExportFormatError('Not a Studyflare export file.');
  const version = doc['export_schema_version'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) throw new ExportFormatError('Export version is missing.');
  if (version > EXPORT_SCHEMA_VERSION) {
    throw new ExportFormatError(`This export comes from a newer Studyflare (format ${version}). Update Studyflare first.`);
  }
  const tables = doc['tables'];
  if (typeof tables !== 'object' || tables === null || Array.isArray(tables)) throw new ExportFormatError('Export has no tables.');
  for (const [name, rows] of Object.entries(tables as Record<string, unknown>)) {
    if (!KNOWN.has(name)) throw new ExportFormatError(`Unknown table "${name}" in export.`);
    if (!Array.isArray(rows)) throw new ExportFormatError(`Table "${name}" isn't a list.`);
    for (const row of rows) {
      if (typeof row !== 'object' || row === null || Array.isArray(row)) throw new ExportFormatError(`A row in "${name}" is malformed.`);
      for (const [col, value] of Object.entries(row as Record<string, unknown>)) {
        // Column names go into SQL text, so they must be plain identifiers.
        if (!IDENT.test(col)) throw new ExportFormatError(`Column "${col}" in "${name}" isn't a valid name.`);
        if (value !== null && typeof value !== 'string' && typeof value !== 'number') {
          throw new ExportFormatError(`Column "${col}" in "${name}" has an unsupported value.`);
        }
      }
    }
  }
  const users = (tables as Record<string, unknown[]>)['users'] ?? [];
  if (users.length !== 1) throw new ExportFormatError('An export must contain exactly one user.');
  return input as ExportDocument;
}

export type Statement = { sql: string; params: Array<string | number | null> };

/**
 * Turn a document into INSERT statements in restore order, each within D1's bound-parameter limit.
 * Self-referencing columns (DEFERRED_COLUMNS) are inserted as NULL and set by trailing UPDATEs.
 */
export function planRestore(doc: ExportDocument): Statement[] {
  const inserts: Statement[] = [];
  const updates: Statement[] = [];
  for (const { name } of EXPORT_TABLES) {
    const rows = doc.tables[name] ?? [];
    if (rows.length === 0) continue;
    const deferred = DEFERRED_COLUMNS[name] ?? [];
    // Rows may omit columns that are NULL; use the union of keys, in first-seen order.
    const columns: string[] = [];
    for (const row of rows) for (const col of Object.keys(row)) if (!columns.includes(col)) columns.push(col);
    if (columns.length > MAX_BOUND_PARAMS) throw new ExportFormatError(`Table "${name}" has too many columns.`);
    const perStmt = Math.max(1, Math.floor(MAX_BOUND_PARAMS / columns.length));
    for (let i = 0; i < rows.length; i += perStmt) {
      const chunk = rows.slice(i, i + perStmt);
      const tuple = `(${columns.map(() => '?').join(', ')})`;
      const params: Array<string | number | null> = [];
      for (const row of chunk) {
        for (const col of columns) params.push(deferred.includes(col) ? null : (row[col] ?? null));
      }
      inserts.push({ sql: `INSERT INTO ${name} (${columns.join(', ')}) VALUES ${chunk.map(() => tuple).join(', ')}`, params });
    }
    for (const col of deferred) {
      for (const row of rows) {
        const value = row[col];
        if (value !== undefined && value !== null) {
          updates.push({ sql: `UPDATE ${name} SET ${col} = ? WHERE id = ?`, params: [value, row['id'] ?? null] });
        }
      }
    }
  }
  // Rebuild the keyword index from passages (external-content FTS5).
  return [...inserts, ...updates, { sql: "INSERT INTO passages_fts(passages_fts) VALUES ('rebuild')", params: [] }];
}

/** gzip a document (CompressionStream exists in Workers and browsers). */
export async function gzipJson(value: unknown): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([JSON.stringify(value)]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function gunzipJson(bytes: Uint8Array<ArrayBuffer>): Promise<unknown> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text());
}
