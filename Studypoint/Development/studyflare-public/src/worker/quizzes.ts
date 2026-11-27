// Practice quizzes (QZ-01..04, step 5). Each question's full content is ONE encrypted payload in
// questions.stem_md (AAD "<question id>#q"); the quiz title is encrypted too. The Worker stores the format
// and difficulty (to count and schedule), and per attempt only the scores; the answer you gave is
// encrypted. Grading happens in the browser (deterministic) or via the AI grader (short answers).

import { isEnvelope } from '../shared/crypto/vault.ts';
import { isUuid7 } from '../shared/uuid7.ts';

export class QuizError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'QuizError';
    this.status = status;
  }
}

const FORMATS = ['mcq', 'tf', 'short', 'numeric'] as const;

export type QuizSummary = { id: string; courseId: string; title: string; count: number; score: number | null; submittedAt: number | null; createdAt: number };
export type QuizDetail = QuizSummary & { questions: Array<{ id: string; format: string; payload: string }> };

async function ownCourse(db: D1Database, userId: string, courseId: unknown): Promise<string> {
  if (typeof courseId !== 'string' || !(await db.prepare('SELECT id FROM courses WHERE id = ? AND user_id = ?').bind(courseId, userId).first())) throw new QuizError(400, 'Choose a course first.');
  return courseId;
}

type QuizRow = { id: string; title: string; config_json: string; score: number | null; submitted_at: number | null; created_at: number; n: number };

const summary = (r: QuizRow): QuizSummary => {
  const cfg = JSON.parse(r.config_json) as { courseId?: string };
  return { id: r.id, courseId: cfg.courseId ?? '', title: r.title, count: r.n, score: r.score, submittedAt: r.submitted_at, createdAt: r.created_at };
};

const LIST = `SELECT q.id, q.title, q.config_json, q.score, q.submitted_at, q.created_at, (SELECT COUNT(*) FROM quiz_items i WHERE i.quiz_id = q.id) AS n
  FROM quizzes q WHERE q.user_id = ? AND q.kind = 'quiz' AND json_extract(q.config_json, '$.hidden') IS NOT 1`;

export async function listQuizzes(db: D1Database, userId: string, courseId: string): Promise<QuizSummary[]> {
  const res = await db.prepare(`${LIST} AND json_extract(q.config_json, '$.courseId') = ? ORDER BY q.created_at DESC`).bind(userId, courseId).all<QuizRow>();
  return res.results.map(summary);
}

export async function createQuiz(db: D1Database, userId: string, input: unknown, now = Date.now()): Promise<QuizSummary> {
  const b = (input ?? {}) as Record<string, unknown>;
  const id = b['id'];
  if (typeof id !== 'string' || !isUuid7(id)) throw new QuizError(400, 'Invalid quiz id.');
  if (!isEnvelope(b['title'])) throw new QuizError(400, 'Quizzes must be encrypted before they’re saved.');
  const courseId = await ownCourse(db, userId, b['courseId']);
  const qs = Array.isArray(b['questions']) ? b['questions'] : [];
  if (qs.length === 0 || qs.length > 50) throw new QuizError(400, 'A quiz needs 1–50 questions.');
  const rows = qs.map((q) => {
    const o = (q ?? {}) as Record<string, unknown>;
    if (typeof o['id'] !== 'string' || !isUuid7(o['id']) || !(FORMATS as readonly string[]).includes(String(o['format'])) || !isEnvelope(o['payload']) || String(o['payload']).length > 60_000) {
      throw new QuizError(400, 'A question is invalid or not encrypted.');
    }
    const d = Number(o['difficulty']);
    return { id: o['id'], format: String(o['format']), payload: String(o['payload']), difficulty: Number.isInteger(d) && d >= 1 && d <= 5 ? d : null };
  });
  await db.batch([
    ...rows.map((r) => db.prepare(`INSERT INTO questions (id, user_id, course_id, format, stem_md, payload_json, difficulty_level, origin, status, created_at)
      VALUES (?, ?, ?, ?, ?, '{}', ?, 'ai', 'active', ?)`).bind(r.id, userId, courseId, r.format, r.payload, r.difficulty, now)),
    db.prepare(`INSERT INTO quizzes (id, user_id, kind, title, config_json, created_at) VALUES (?, ?, 'quiz', ?, ?, ?)`).bind(id, userId, b['title'], JSON.stringify({ courseId }), now),
    ...rows.map((r, i) => db.prepare('INSERT INTO quiz_items (quiz_id, position, question_id) VALUES (?, ?, ?)').bind(id, i, r.id)),
  ]);
  return { id, courseId, title: String(b['title']), count: rows.length, score: null, submittedAt: null, createdAt: now };
}

export async function getQuiz(db: D1Database, userId: string, id: string): Promise<QuizDetail | null> {
  const r = await db.prepare(`${LIST} AND q.id = ?`).bind(userId, id).first<QuizRow>();
  if (!r) return null;
  const qs = await db.prepare(`SELECT qu.id, qu.format, qu.stem_md FROM quiz_items i JOIN questions qu ON qu.id = i.question_id
    WHERE i.quiz_id = ? AND qu.user_id = ? ORDER BY i.position`).bind(id, userId).all<{ id: string; format: string; stem_md: string }>();
  return { ...summary(r), questions: qs.results.map((q) => ({ id: q.id, format: q.format, payload: q.stem_md })) };
}

/** Record a finished attempt: one append-only row per question, then the quiz's latest score. */
export async function submitQuiz(db: D1Database, userId: string, quizId: string, input: unknown, now = Date.now()): Promise<{ score: number }> {
  const quiz = await getQuiz(db, userId, quizId);
  if (!quiz) throw new QuizError(404, "That quiz doesn't exist.");
  const b = (input ?? {}) as Record<string, unknown>;
  const items = Array.isArray(b['items']) ? b['items'] : [];
  const valid = new Set(quiz.questions.map((q) => q.id));
  const rows = items.map((it) => {
    const o = (it ?? {}) as Record<string, unknown>;
    const score = (v: unknown) => (typeof v === 'number' && v >= 0 && v <= 1 ? v : null);
    if (typeof o['questionId'] !== 'string' || !valid.has(o['questionId']) || typeof o['clientId'] !== 'string' || !isUuid7(o['clientId']) || !isEnvelope(o['response'])) throw new QuizError(400, 'An answer is invalid or not encrypted.');
    const final = score(o['finalScore']);
    if (final === null) throw new QuizError(400, 'Every answer needs a score.');
    return { qid: o['questionId'], cid: o['clientId'], response: String(o['response']), auto: score(o['autoScore']), ai: score(o['aiScore']), final, dur: typeof o['durationMs'] === 'number' ? Math.round(o['durationMs']) : null };
  });
  if (rows.length === 0) throw new QuizError(400, 'No answers to save.');
  const total = rows.reduce((n, r) => n + r.final, 0) / quiz.questions.length;
  await db.batch([
    ...rows.map((r) => db.prepare(`INSERT OR IGNORE INTO attempts (id, user_id, question_id, quiz_id, response_json, auto_score, ai_suggested_score, final_score, answered_at, duration_ms, client_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(r.cid, userId, r.qid, quizId, JSON.stringify({ enc: r.response }), r.auto, r.ai, r.final, now, r.dur, r.cid)),
    db.prepare('UPDATE quizzes SET score = ?, submitted_at = ? WHERE id = ? AND user_id = ?').bind(total, now, quizId, userId),
  ]);
  return { score: total };
}

/** Hide a quiz from the list (attempts are append-only, so the rows stay). */
export async function hideQuiz(db: D1Database, userId: string, id: string): Promise<boolean> {
  const res = await db.prepare(`UPDATE quizzes SET config_json = json_set(config_json, '$.hidden', 1) WHERE id = ? AND user_id = ?`).bind(id, userId).run();
  return (res.meta.changes ?? 0) > 0;
}
