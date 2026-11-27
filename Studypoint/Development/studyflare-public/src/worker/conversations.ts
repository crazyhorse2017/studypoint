// Saved conversations (step 6a, AST-06, AUTH-08). Kept until Alex deletes them. The title and every message
// are ciphertext (the Worker refuses plaintext): a question is one envelope, an answer is one envelope
// holding the verified segments plus the passages it was checked against, so citations still open after
// the source changes. The Worker stores only ids, the course, the mode, the coverage label and times.

import { isEnvelope } from '../shared/crypto/vault.ts';
import { isUuid7 } from '../shared/uuid7.ts';

export class ConversationError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ConversationError';
    this.status = status;
  }
}

/** One answer envelope holds up to 8 passages of ≤ 6,000 characters plus the reply, encrypted (base64). */
export const MAX_MESSAGE_CHARS = 200_000;
const MAX_TITLE_CHARS = 2_000;
const MODES = ['direct', 'tutor'] as const;
const COVERAGES = ['covered', 'partial', 'not_found'] as const;

export type ConversationSummary = { id: string; courseId: string | null; title: string; mode: string; messages: number; createdAt: number; updatedAt: number };
export type StoredMessage = { id: string; role: 'user' | 'assistant'; content: string; coverage: string | null; createdAt: number };

type Row = { id: string; course_id: string | null; title: string; mode: string; created_at: number; updated_at: number; n: number };

const summary = (r: Row): ConversationSummary => ({ id: r.id, courseId: r.course_id, title: r.title, mode: r.mode, messages: r.n, createdAt: r.created_at, updatedAt: r.updated_at });

const SELECT = `SELECT c.id, c.course_id, c.title, c.mode, c.created_at, c.updated_at,
  (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS n FROM conversations c WHERE c.user_id = ?`;

/** All conversations, newest first; `courseId` narrows to one course. */
export async function listConversations(db: D1Database, userId: string, courseId: string | null): Promise<ConversationSummary[]> {
  const res = courseId
    ? await db.prepare(`${SELECT} AND c.course_id = ? ORDER BY c.updated_at DESC LIMIT 500`).bind(userId, courseId).all<Row>()
    : await db.prepare(`${SELECT} ORDER BY c.updated_at DESC LIMIT 500`).bind(userId).all<Row>();
  return res.results.map(summary);
}

export async function createConversation(db: D1Database, userId: string, input: unknown, now = Date.now()): Promise<ConversationSummary> {
  const b = (input ?? {}) as Record<string, unknown>;
  const id = b['id'];
  if (typeof id !== 'string' || !isUuid7(id)) throw new ConversationError(400, 'Invalid conversation id.');
  if (!isEnvelope(b['title']) || String(b['title']).length > MAX_TITLE_CHARS) throw new ConversationError(400, 'Conversations must be encrypted before they’re saved.');
  const mode = (MODES as readonly string[]).includes(String(b['mode'])) ? String(b['mode']) : 'direct';
  let courseId: string | null = null;
  if (b['courseId'] !== null && b['courseId'] !== undefined) {
    if (typeof b['courseId'] !== 'string' || !(await db.prepare('SELECT id FROM courses WHERE id = ? AND user_id = ?').bind(b['courseId'], userId).first())) throw new ConversationError(400, 'That course doesn’t exist.');
    courseId = b['courseId'];
  }
  await db.prepare('INSERT INTO conversations (id, user_id, course_id, title, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, userId, courseId, String(b['title']), mode, now, now).run();
  return { id, courseId, title: String(b['title']), mode, messages: 0, createdAt: now, updatedAt: now };
}

export async function getConversation(db: D1Database, userId: string, id: string): Promise<(ConversationSummary & { messageList: StoredMessage[] }) | null> {
  const r = await db.prepare(`${SELECT} AND c.id = ?`).bind(userId, id).first<Row>();
  if (!r) return null;
  const ms = await db.prepare('SELECT id, role, content_md, coverage, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at, id')
    .bind(id).all<{ id: string; role: 'user' | 'assistant'; content_md: string; coverage: string | null; created_at: number }>();
  return { ...summary(r), messageList: ms.results.map((m) => ({ id: m.id, role: m.role, content: m.content_md, coverage: m.coverage, createdAt: m.created_at })) };
}

/** Append a question and/or its answer (at most 2 messages per call), then bump the conversation. */
export async function addMessages(db: D1Database, userId: string, conversationId: string, input: unknown, now = Date.now()): Promise<{ added: number }> {
  const own = await db.prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?').bind(conversationId, userId).first();
  if (!own) throw new ConversationError(404, 'That conversation doesn’t exist.');
  const list = Array.isArray((input as Record<string, unknown> | null)?.['messages']) ? ((input as Record<string, unknown>)['messages'] as unknown[]) : [];
  if (list.length === 0 || list.length > 2) throw new ConversationError(400, 'Send 1 or 2 messages at a time.');
  const rows = list.map((m, i) => {
    const o = (m ?? {}) as Record<string, unknown>;
    if (typeof o['id'] !== 'string' || !isUuid7(o['id'])) throw new ConversationError(400, 'Invalid message id.');
    if (o['role'] !== 'user' && o['role'] !== 'assistant') throw new ConversationError(400, 'Invalid message role.');
    if (!isEnvelope(o['content']) || String(o['content']).length > MAX_MESSAGE_CHARS) throw new ConversationError(400, 'Messages must be encrypted before they’re saved.');
    const coverage = o['role'] === 'assistant' && (COVERAGES as readonly string[]).includes(String(o['coverage'])) ? String(o['coverage']) : null;
    return { id: o['id'], role: o['role'], content: String(o['content']), coverage, at: now + i };
  });
  await db.batch([
    ...rows.map((r) => db.prepare(`INSERT OR IGNORE INTO messages (id, conversation_id, role, content_md, coverage, provider, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(r.id, conversationId, r.role, r.content, r.coverage, r.role === 'assistant' ? 'workers-ai' : null, r.at)),
    db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ? AND user_id = ?').bind(now, conversationId, userId),
  ]);
  return { added: rows.length };
}

export async function renameConversation(db: D1Database, userId: string, id: string, input: unknown): Promise<boolean> {
  const title = (input as Record<string, unknown> | null)?.['title'];
  if (!isEnvelope(title) || String(title).length > MAX_TITLE_CHARS) throw new ConversationError(400, 'Conversations must be encrypted before they’re saved.');
  const res = await db.prepare('UPDATE conversations SET title = ? WHERE id = ? AND user_id = ?').bind(String(title), id, userId).run();
  return (res.meta.changes ?? 0) > 0;
}

/** Permanently delete a conversation and its messages (Alex confirms first in the app). */
export async function deleteConversation(db: D1Database, userId: string, id: string): Promise<boolean> {
  const own = await db.prepare('SELECT id FROM conversations WHERE id = ? AND user_id = ?').bind(id, userId).first();
  if (!own) return false;
  await db.batch([
    db.prepare('DELETE FROM messages WHERE conversation_id = ?').bind(id),
    db.prepare('DELETE FROM conversations WHERE id = ? AND user_id = ?').bind(id, userId),
  ]);
  return true;
}
