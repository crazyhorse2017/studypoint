// Typed notes (LIB-08, AUTH-08). A note is a `sources` row (kind 'note', origin 'app_note', privacy
// 'personal') plus a `notes` row. The title and body arrive ALREADY ENCRYPTED by the browser: the Worker
// stores sf1 envelopes and refuses anything else, so a plaintext note can never be saved by mistake.
// Ids are made by the client (UUIDv7) because each ciphertext is bound to its record id.

import { isEnvelope } from '../shared/crypto/vault.ts';
import { isUuid7 } from '../shared/uuid7.ts';

export class NoteError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'NoteError';
    this.status = status;
  }
}

/** About 1 MB of ciphertext per note body; a long note is far smaller. */
export const MAX_NOTE_BODY_CHARS = 1_400_000;
export const MAX_NOTE_TITLE_CHARS = 2_000;

export type NoteSummary = { id: string; courseId: string | null; title: string; createdAt: number; updatedAt: number };
export type Note = NoteSummary & { body: string };

type Row = { id: string; course_id: string | null; title: string; created_at: number; updated_at: number; body_md?: string };

const summary = (r: Row): NoteSummary => ({ id: r.id, courseId: r.course_id, title: r.title, createdAt: r.created_at, updatedAt: r.updated_at });

function checkSealed(title: unknown, body: unknown): { title: string; body: string } {
  if (typeof body === 'string' && body.length > MAX_NOTE_BODY_CHARS) throw new NoteError(413, 'This note is too long to save. Split it into two notes.');
  if (typeof title === 'string' && title.length > MAX_NOTE_TITLE_CHARS) throw new NoteError(413, 'That title is too long.');
  if (!isEnvelope(title) || !isEnvelope(body)) throw new NoteError(400, 'Notes must be encrypted before they’re saved.');
  return { title: title as string, body: body as string };
}

/** Every note belongs to one of the user's courses (LIB-08, 2026-11-26): no course, no note. */
async function checkCourse(db: D1Database, userId: string, courseId: unknown): Promise<string> {
  if (courseId === null || courseId === undefined || courseId === '') throw new NoteError(400, 'Choose a course for this note first.');
  if (typeof courseId !== 'string') throw new NoteError(400, 'Invalid course.');
  const ok = await db.prepare('SELECT id FROM courses WHERE id = ? AND user_id = ?').bind(courseId, userId).first();
  if (!ok) throw new NoteError(404, "That course doesn't exist.");
  return courseId;
}

const BASE = `SELECT s.id, s.course_id, s.title, s.created_at, s.updated_at FROM sources s
  WHERE s.user_id = ? AND s.kind = 'note' AND s.deleted_at IS NULL`;

export async function listNotes(db: D1Database, userId: string, courseId?: string | null): Promise<NoteSummary[]> {
  const res = courseId
    ? await db.prepare(`${BASE} AND s.course_id = ? ORDER BY s.updated_at DESC`).bind(userId, courseId).all<Row>()
    : await db.prepare(`${BASE} ORDER BY s.updated_at DESC`).bind(userId).all<Row>();
  return res.results.map(summary);
}

export async function getNote(db: D1Database, userId: string, id: string): Promise<Note | null> {
  const r = await db.prepare(`SELECT s.id, s.course_id, s.title, s.created_at, s.updated_at, n.body_md FROM sources s
    JOIN notes n ON n.source_id = s.id WHERE s.id = ? AND s.user_id = ? AND s.kind = 'note' AND s.deleted_at IS NULL`).bind(id, userId).first<Row>();
  return r ? { ...summary(r), body: r.body_md ?? '' } : null;
}

export async function createNote(db: D1Database, userId: string, input: unknown, now = Date.now()): Promise<Note> {
  const b = (input ?? {}) as Record<string, unknown>;
  const id = b['id'];
  if (typeof id !== 'string' || !isUuid7(id)) throw new NoteError(400, 'Invalid note id.');
  const sealed = checkSealed(b['title'], b['body']);
  const courseId = await checkCourse(db, userId, b['courseId']);
  if (await db.prepare('SELECT id FROM sources WHERE id = ?').bind(id).first()) throw new NoteError(409, 'That note already exists.');
  await db.batch([
    db.prepare(`INSERT INTO sources (id, user_id, course_id, title, kind, origin, privacy, citeable, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'note', 'app_note', 'personal', 1, ?, ?)`).bind(id, userId, courseId, sealed.title, now, now),
    db.prepare('INSERT INTO notes (source_id, body_md, dirty, updated_at) VALUES (?, ?, 1, ?)').bind(id, sealed.body, now),
  ]);
  return { id, courseId, title: sealed.title, body: sealed.body, createdAt: now, updatedAt: now };
}

/**
 * Save a new version of a note. `baseUpdatedAt` must match what the editor loaded, so two open tabs
 * can't silently overwrite each other (409 → the editor offers to reload).
 */
export async function updateNote(db: D1Database, userId: string, id: string, input: unknown, now = Date.now()): Promise<Note> {
  const b = (input ?? {}) as Record<string, unknown>;
  const sealed = checkSealed(b['title'], b['body']);
  const current = await getNote(db, userId, id);
  if (!current) throw new NoteError(404, "That note doesn't exist.");
  if (b['baseUpdatedAt'] !== current.updatedAt) throw new NoteError(409, 'This note was changed in another tab or device. Reload it to see the latest version.');
  // A note from before courses were required must be given one before it can be saved again.
  const courseId = await checkCourse(db, userId, 'courseId' in b ? b['courseId'] : current.courseId);
  const stamp = Math.max(now, current.updatedAt + 1);
  await db.batch([
    db.prepare('UPDATE sources SET title = ?, course_id = ?, updated_at = ? WHERE id = ? AND user_id = ?').bind(sealed.title, courseId, stamp, id, userId),
    db.prepare('UPDATE notes SET body_md = ?, dirty = 1, updated_at = ? WHERE source_id = ?').bind(sealed.body, stamp, id),
  ]);
  return { ...current, courseId, title: sealed.title, body: sealed.body, updatedAt: stamp };
}

/** Soft delete (undo-able for 30 days; the trash sweep is part of T1.12). */
export async function deleteNote(db: D1Database, userId: string, id: string, now = Date.now()): Promise<boolean> {
  const res = await db.prepare("UPDATE sources SET deleted_at = ? WHERE id = ? AND user_id = ? AND kind = 'note' AND deleted_at IS NULL").bind(now, id, userId).run();
  return (res.meta.changes ?? 0) > 0;
}

export async function restoreNote(db: D1Database, userId: string, id: string): Promise<boolean> {
  const res = await db.prepare("UPDATE sources SET deleted_at = NULL WHERE id = ? AND user_id = ? AND kind = 'note' AND deleted_at IS NOT NULL").bind(id, userId).run();
  return (res.meta.changes ?? 0) > 0;
}
