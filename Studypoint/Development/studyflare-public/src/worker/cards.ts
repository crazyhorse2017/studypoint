// Flashcards and review (CRD-01..09, AUTH-08). A card's content is ONE encrypted payload (front_md holds the
// sf1 envelope, AAD "<card id>#card"); the Worker sees only the card type and the variant ids, which it needs
// to schedule each side / blank / mask separately. Scheduling is FSRS (shared/fsrs.ts), decided HERE, with
// every rating appended to review_log (never edited) and the exam cap applied (CRD-07).

import { isEnvelope } from '../shared/crypto/vault.ts';
import { VARIANT_RE, type CardType } from '../shared/cards.ts';
// ts-fsrs is loaded only when a review is recorded (submitReview), keeping every other route light.
import { FSRS_VERSION, newStateRow, paramsHash, type DbState, type RatingNumber, type StateRow } from '../shared/fsrsState.ts';
import { cramNewToday, cramStatus } from '../shared/examCram.ts';
import { isUuid7, uuid7 } from '../shared/uuid7.ts';

export class CardError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'CardError';
    this.status = status;
  }
}

const TYPES: readonly CardType[] = ['basic', 'cloze', 'occlusion'];
export const MAX_CARD_CHARS = 200_000;
const DAY = 86_400_000;

export type CardInfo = { id: string; courseId: string | null; type: CardType; payload: string; variants: string[]; createdAt: number; updatedAt: number };

function checkInput(b: Record<string, unknown>): { type: CardType; payload: string; variants: string[] } {
  const type = b['type'];
  if (typeof type !== 'string' || !(TYPES as readonly string[]).includes(type)) throw new CardError(400, 'Unknown card type.');
  const payload = b['payload'];
  if (typeof payload === 'string' && payload.length > MAX_CARD_CHARS) throw new CardError(413, 'This card is too large.');
  if (!isEnvelope(payload)) throw new CardError(400, 'Cards must be encrypted before they’re saved.');
  const variants = b['variants'];
  if (!Array.isArray(variants) || variants.length === 0 || variants.length > 60 || !variants.every((v) => typeof v === 'string' && VARIANT_RE.test(v)) || new Set(variants).size !== variants.length) {
    throw new CardError(400, 'Invalid card sides.');
  }
  const ok = type === 'basic' ? variants.every((v) => v === 'main' || v === 'reverse') : type === 'cloze' ? variants.every((v) => /^c\d+$/.test(v)) : variants.every((v) => v.startsWith('m:'));
  if (!ok) throw new CardError(400, 'Those card sides don’t match the card type.');
  return { type: type as CardType, payload: payload as string, variants: variants as string[] };
}

async function ownCourse(db: D1Database, userId: string, courseId: unknown): Promise<string> {
  if (typeof courseId !== 'string' || !(await db.prepare('SELECT id FROM courses WHERE id = ? AND user_id = ?').bind(courseId, userId).first())) {
    throw new CardError(400, 'Choose a course for this card first.');
  }
  return courseId;
}

export async function listCards(db: D1Database, userId: string, courseId: string | null): Promise<CardInfo[]> {
  const base = `SELECT c.id, c.course_id, c.type, c.front_md, c.created_at, c.updated_at,
      (SELECT group_concat(variant) FROM card_states s WHERE s.card_id = c.id) AS variants
    FROM cards c WHERE c.user_id = ? AND c.deleted_at IS NULL`;
  const res = courseId
    ? await db.prepare(`${base} AND c.course_id = ? ORDER BY c.created_at DESC`).bind(userId, courseId).all<CardRow>()
    : await db.prepare(`${base} ORDER BY c.created_at DESC`).bind(userId).all<CardRow>();
  return res.results.map(toInfo);
}

type CardRow = { id: string; course_id: string | null; type: CardType; front_md: string; created_at: number; updated_at: number; variants: string | null };
const toInfo = (r: CardRow): CardInfo => ({ id: r.id, courseId: r.course_id, type: r.type, payload: r.front_md, variants: (r.variants ?? '').split(',').filter(Boolean).sort(), createdAt: r.created_at, updatedAt: r.updated_at });

export async function createCard(db: D1Database, userId: string, input: unknown, now = Date.now()): Promise<CardInfo> {
  const b = (input ?? {}) as Record<string, unknown>;
  const id = b['id'];
  if (typeof id !== 'string' || !isUuid7(id)) throw new CardError(400, 'Invalid card id.');
  const { type, payload, variants } = checkInput(b);
  const courseId = await ownCourse(db, userId, b['courseId']);
  if (await db.prepare('SELECT id FROM cards WHERE id = ?').bind(id).first()) throw new CardError(409, 'That card already exists.');
  const s = newStateRow(now);
  await db.batch([
    db.prepare(`INSERT INTO cards (id, user_id, course_id, type, front_md, back_md, data_json, reversible, origin, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, NULL, '{}', ?, 'manual', 'active', ?, ?)`).bind(id, userId, courseId, type, payload, variants.includes('reverse') ? 1 : 0, now, now),
    ...variants.map((v) => db.prepare(`INSERT INTO card_states (card_id, variant, user_id, state, due_at, learning_steps, reps, lapses) VALUES (?, ?, ?, 'new', ?, 0, 0, 0)`).bind(id, v, userId, s.due_at)),
  ]);
  return { id, courseId, type, payload, variants: [...variants].sort(), createdAt: now, updatedAt: now };
}

/** Edit a card. Sides that disappear lose their schedule; new sides start as new. Kept sides keep theirs. */
export async function updateCard(db: D1Database, userId: string, id: string, input: unknown, now = Date.now()): Promise<CardInfo> {
  const b = (input ?? {}) as Record<string, unknown>;
  const current = await db.prepare(`SELECT c.id, c.course_id, c.type, c.front_md, c.created_at, c.updated_at,
      (SELECT group_concat(variant) FROM card_states s WHERE s.card_id = c.id) AS variants
    FROM cards c WHERE c.id = ? AND c.user_id = ? AND c.deleted_at IS NULL`).bind(id, userId).first<CardRow>();
  if (!current) throw new CardError(404, "That card doesn't exist.");
  const { type, payload, variants } = checkInput({ ...b, type: b['type'] ?? current.type });
  if (type !== current.type) throw new CardError(400, 'A card can’t change type. Make a new card instead.');
  const courseId = 'courseId' in b ? await ownCourse(db, userId, b['courseId']) : current.course_id;
  const had = new Set((current.variants ?? '').split(',').filter(Boolean));
  const stmts: D1PreparedStatement[] = [
    db.prepare('UPDATE cards SET front_md = ?, course_id = ?, reversible = ?, updated_at = ? WHERE id = ? AND user_id = ?').bind(payload, courseId, variants.includes('reverse') ? 1 : 0, now, id, userId),
  ];
  for (const v of variants) if (!had.has(v)) stmts.push(db.prepare(`INSERT INTO card_states (card_id, variant, user_id, state, due_at, learning_steps, reps, lapses) VALUES (?, ?, ?, 'new', ?, 0, 0, 0)`).bind(id, v, userId, now));
  for (const v of had) if (!variants.includes(v)) stmts.push(db.prepare('DELETE FROM card_states WHERE card_id = ? AND variant = ? AND user_id = ?').bind(id, v, userId));
  await db.batch(stmts);
  return { id, courseId, type, payload, variants: [...variants].sort(), createdAt: current.created_at, updatedAt: now };
}

export async function deleteCard(db: D1Database, userId: string, id: string, now = Date.now()): Promise<boolean> {
  const res = await db.prepare('UPDATE cards SET deleted_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL').bind(now, id, userId).run();
  return (res.meta.changes ?? 0) > 0;
}

export async function restoreCard(db: D1Database, userId: string, id: string): Promise<boolean> {
  const res = await db.prepare('UPDATE cards SET deleted_at = NULL WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL').bind(id, userId).run();
  return (res.meta.changes ?? 0) > 0;
}

// ---------------------------------------------------------------- settings + exams --

export type StudySettings = { newPerDay: number; retention: number };

export async function getStudySettings(db: D1Database, userId: string): Promise<StudySettings> {
  const r = await db.prepare('SELECT new_per_day, target_retention FROM settings WHERE user_id = ?').bind(userId).first<{ new_per_day: number; target_retention: number }>();
  return { newPerDay: r?.new_per_day ?? 20, retention: r?.target_retention ?? 0.9 };
}

export async function setStudySettings(db: D1Database, userId: string, input: unknown, now = Date.now()): Promise<StudySettings> {
  const b = (input ?? {}) as Record<string, unknown>;
  const cur = await getStudySettings(db, userId);
  const newPerDay = typeof b['newPerDay'] === 'number' ? Math.round(b['newPerDay']) : cur.newPerDay;
  const retention = typeof b['retention'] === 'number' ? Math.round(b['retention'] * 100) / 100 : cur.retention;
  if (newPerDay < 0 || newPerDay > 200) throw new CardError(400, 'New cards per day must be between 0 and 200.');
  if (retention < 0.7 || retention > 0.97) throw new CardError(400, 'The recall target must be between 70% and 97%.');
  await db.prepare(`INSERT INTO settings (user_id, new_per_day, target_retention, updated_at) VALUES (?1, ?2, ?3, ?4)
    ON CONFLICT(user_id) DO UPDATE SET new_per_day = ?2, target_retention = ?3, updated_at = ?4`).bind(userId, newPerDay, retention, now).run();
  return { newPerDay, retention };
}

export type Exam = { courseId: string; at: number };

/** Each course's next exam (the earliest one still in the future). */
export async function upcomingExams(db: D1Database, userId: string, now = Date.now()): Promise<Exam[]> {
  const res = await db.prepare(`SELECT course_id, MIN(due_at) AS at FROM deadlines
    WHERE user_id = ? AND kind = 'exam' AND course_id IS NOT NULL AND due_at > ? GROUP BY course_id`).bind(userId, now).all<{ course_id: string; at: number }>();
  return res.results.map((r) => ({ courseId: r.course_id, at: r.at }));
}

/** Set (or clear, with null) the exam date of a course. One manual exam per course. */
export async function setExam(db: D1Database, userId: string, courseId: string, at: unknown, now = Date.now()): Promise<Exam | null> {
  await ownCourse(db, userId, courseId);
  await db.prepare("DELETE FROM deadlines WHERE user_id = ? AND course_id = ? AND kind = 'exam' AND origin = 'manual'").bind(userId, courseId).run();
  if (at === null) return null;
  if (typeof at !== 'number' || !Number.isFinite(at) || at <= now || at > now + 400 * DAY) throw new CardError(400, 'Choose an exam date in the next year.');
  await db.prepare("INSERT INTO deadlines (id, user_id, course_id, title, kind, due_at, origin, created_at) VALUES (?, ?, ?, 'Exam', 'exam', ?, 'manual', ?)").bind(uuid7(now), userId, courseId, at, now).run();
  return { courseId, at };
}

// ---------------------------------------------------------------- review --

export type QueueItem = StateRow & { cardId: string; variant: string; courseId: string | null; type: CardType; payload: string };

type QueueRow = { card_id: string; variant: string; course_id: string | null; type: CardType; front_md: string; state: DbState; due_at: number; stability: number | null; difficulty: number | null; scheduled_days: number | null; learning_steps: number; reps: number; lapses: number; last_review_at: number | null };

const QUEUE_COLS = `s.card_id, s.variant, c.course_id, c.type, c.front_md, s.state, s.due_at, s.stability, s.difficulty, s.scheduled_days, s.learning_steps, s.reps, s.lapses, s.last_review_at
  FROM card_states s JOIN cards c ON c.id = s.card_id
  LEFT JOIN courses co ON co.id = c.course_id
  WHERE s.user_id = ? AND c.deleted_at IS NULL AND c.status = 'active' AND (co.archived_at IS NULL)`;

const toItem = (r: QueueRow): QueueItem => ({
  cardId: r.card_id, variant: r.variant, courseId: r.course_id, type: r.type, payload: r.front_md,
  state: r.state, due_at: r.due_at, stability: r.stability, difficulty: r.difficulty, scheduled_days: r.scheduled_days,
  learning_steps: r.learning_steps, reps: r.reps, lapses: r.lapses, last_review_at: r.last_review_at,
});

/** Start of "today" for new-card counting: a rolling 24 hours keeps it simple and timezone-free. */
const dayStart = (now: number) => now - DAY;

export type Queue = { due: QueueItem[]; fresh: QueueItem[]; exams: Exam[]; settings: StudySettings; newIntroducedToday: number };

/**
 * Today's queue: everything due now (learning steps first), then new cards up to today's allowance.
 * Courses with an upcoming exam get their new cards first and a bigger share (CRD-07).
 */
export async function reviewQueue(db: D1Database, userId: string, courseId: string | null, now = Date.now()): Promise<Queue> {
  const settings = await getStudySettings(db, userId);
  const exams = await upcomingExams(db, userId, now);
  const courseFilter = courseId ? ' AND c.course_id = ?' : '';
  const args = (extra: unknown[]) => (courseId ? [userId, ...extra.slice(0, -1), courseId, ...extra.slice(-1)] : [userId, ...extra]);
  const due = await db.prepare(`SELECT ${QUEUE_COLS} AND s.state <> 'new' AND s.due_at <= ?${courseFilter} ORDER BY (s.state = 'review'), s.due_at LIMIT ?`)
    .bind(...(courseId ? [userId, now, courseId, 1000] : [userId, now, 1000])).all<QueueRow>();
  const introduced = await db.prepare(`SELECT COUNT(DISTINCT card_id || ':' || variant) AS n FROM review_log WHERE user_id = ? AND reviewed_at >= ? AND state_before = 'new'`).bind(userId, dayStart(now)).first<{ n: number }>();
  const newIntroducedToday = introduced?.n ?? 0;
  const examCourses = new Map(exams.map((e) => [e.courseId, e.at]));
  const freshRows = await db.prepare(`SELECT ${QUEUE_COLS} AND s.state = 'new'${courseFilter} ORDER BY c.created_at, s.variant LIMIT ?`)
    .bind(...args([2000])).all<QueueRow>();
  // Allowance: the normal daily limit, raised for exam courses to their fair share.
  const normalLeft = Math.max(0, settings.newPerDay - newIntroducedToday);
  const byCourse = new Map<string, QueueRow[]>();
  for (const r of freshRows.results) {
    const k = r.course_id ?? '';
    const list = byCourse.get(k);
    if (list) list.push(r);
    else byCourse.set(k, [r]);
  }
  // Per-course introductions so far today, so reopening the queue doesn't keep raising an exam's share.
  const perCourse = await db.prepare(`SELECT c.course_id, COUNT(DISTINCT r.card_id || ':' || r.variant) AS n FROM review_log r JOIN cards c ON c.id = r.card_id
    WHERE r.user_id = ? AND r.reviewed_at >= ? AND r.state_before = 'new' GROUP BY c.course_id`).bind(userId, dayStart(now)).all<{ course_id: string | null; n: number }>();
  const doneToday = new Map(perCourse.results.map((r) => [r.course_id ?? '', r.n]));
  const fresh: QueueItem[] = [];
  for (const [cid, rows] of byCourse) {
    const examAt = examCourses.get(cid);
    if (examAt === undefined) continue;
    const done = doneToday.get(cid) ?? 0;
    const st = cramStatus(examAt, now, rows.length + done, settings.newPerDay);
    const share = Math.max(0, cramNewToday(rows.length + done, st.daysLeft, 0) - done);
    fresh.push(...rows.slice(0, share).map(toItem));
  }
  let left = normalLeft;
  for (const [cid, rows] of byCourse) {
    if (examCourses.has(cid) || left <= 0) continue;
    const take = rows.slice(0, left);
    left -= take.length;
    fresh.push(...take.map(toItem));
  }
  return { due: due.results.map(toItem), fresh, exams, settings, newIntroducedToday };
}

export type ReviewInput = { clientId: string; cardId: string; variant: string; rating: RatingNumber; reviewedAt: number; durationMs: number | null };

function checkReview(b: Record<string, unknown>, now: number): ReviewInput {
  const { clientId, cardId, variant, rating, reviewedAt, durationMs } = b;
  if (typeof clientId !== 'string' || !isUuid7(clientId) || typeof cardId !== 'string' || typeof variant !== 'string' || !VARIANT_RE.test(variant)) throw new CardError(400, 'Invalid review.');
  if (rating !== 1 && rating !== 2 && rating !== 3 && rating !== 4) throw new CardError(400, 'Ratings are 1 to 4.');
  const at = typeof reviewedAt === 'number' && Math.abs(reviewedAt - now) < 7 * DAY ? reviewedAt : now;
  const dur = typeof durationMs === 'number' && durationMs >= 0 && durationMs < 3_600_000 ? Math.round(durationMs) : null;
  return { clientId, cardId, variant, rating, reviewedAt: at, durationMs: dur };
}

/**
 * Record one rating. Idempotent by clientId: a retried request returns the already-saved state.
 * The new state is computed here (never trusted from the client) and capped by the course's exam date.
 */
export async function submitReview(db: D1Database, userId: string, input: unknown, now = Date.now()): Promise<StateRow> {
  const r = checkReview((input ?? {}) as Record<string, unknown>, now);
  const row = await db.prepare(`SELECT s.state, s.due_at, s.stability, s.difficulty, s.scheduled_days, s.learning_steps, s.reps, s.lapses, s.last_review_at, c.course_id
    FROM card_states s JOIN cards c ON c.id = s.card_id WHERE s.card_id = ? AND s.variant = ? AND s.user_id = ? AND c.deleted_at IS NULL`).bind(r.cardId, r.variant, userId).first<StateRow & { course_id: string | null }>();
  if (!row) throw new CardError(404, "That card doesn't exist.");
  if (await db.prepare('SELECT id FROM review_log WHERE client_id = ?').bind(r.clientId).first()) return row;
  const settings = await getStudySettings(db, userId);
  const exam = row.course_id ? (await upcomingExams(db, userId, r.reviewedAt)).find((e) => e.courseId === row.course_id) : undefined;
  const { review } = await import('../shared/fsrs.ts');
  const { next, scheduledDays } = review(row, r.rating, r.reviewedAt, settings.retention, exam?.at ?? null);
  await db.batch([
    db.prepare(`INSERT INTO review_log (id, user_id, card_id, variant, rating, reviewed_at, duration_ms, state_before, stability_before, difficulty_before, scheduled_days, fsrs_version, params_hash, client_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(uuid7(now), userId, r.cardId, r.variant, r.rating, r.reviewedAt, r.durationMs, row.state, row.stability, row.difficulty, scheduledDays, FSRS_VERSION, paramsHash(settings.retention), r.clientId),
    db.prepare(`UPDATE card_states SET state = ?, due_at = ?, stability = ?, difficulty = ?, scheduled_days = ?, learning_steps = ?, reps = ?, lapses = ?, last_review_at = ?
      WHERE card_id = ? AND variant = ? AND user_id = ?`).bind(next.state, next.due_at, next.stability, next.difficulty, next.scheduled_days, next.learning_steps, next.reps, next.lapses, next.last_review_at, r.cardId, r.variant, userId),
  ]);
  return next;
}

export type Summary = { dueNow: number; dueToday: number; newAvailable: number; newToday: number; reviewedToday: number; exams: Array<Exam & { unseen: number; onTrack: boolean; daysLeft: number }> };

/** Numbers for Today: what's due, what's new, and how each exam is going. */
export async function reviewSummary(db: D1Database, userId: string, now = Date.now()): Promise<Summary> {
  const settings = await getStudySettings(db, userId);
  const counts = await db.prepare(`SELECT
      SUM(s.state <> 'new' AND s.due_at <= ?2) AS due_now,
      SUM(s.state <> 'new' AND s.due_at <= ?3) AS due_today,
      SUM(s.state = 'new') AS fresh
    FROM card_states s JOIN cards c ON c.id = s.card_id LEFT JOIN courses co ON co.id = c.course_id
    WHERE s.user_id = ?1 AND c.deleted_at IS NULL AND c.status = 'active' AND co.archived_at IS NULL`).bind(userId, now, now + DAY).first<{ due_now: number | null; due_today: number | null; fresh: number | null }>();
  const reviewed = await db.prepare(`SELECT COUNT(*) AS n, SUM(state_before = 'new') AS fresh FROM review_log WHERE user_id = ? AND reviewed_at >= ?`).bind(userId, dayStart(now)).first<{ n: number; fresh: number | null }>();
  const exams = await upcomingExams(db, userId, now);
  const out: Summary['exams'] = [];
  for (const e of exams) {
    const u = await db.prepare(`SELECT COUNT(*) AS n FROM card_states s JOIN cards c ON c.id = s.card_id WHERE s.user_id = ? AND c.course_id = ? AND s.state = 'new' AND c.deleted_at IS NULL`).bind(userId, e.courseId).first<{ n: number }>();
    const st = cramStatus(e.at, now, u?.n ?? 0, settings.newPerDay);
    out.push({ ...e, unseen: st.unseen, onTrack: st.onTrack, daysLeft: st.daysLeft });
  }
  return {
    dueNow: counts?.due_now ?? 0,
    dueToday: counts?.due_today ?? 0,
    newAvailable: counts?.fresh ?? 0,
    newToday: Math.min(counts?.fresh ?? 0, Math.max(0, settings.newPerDay - (reviewed?.fresh ?? 0))),
    reviewedToday: reviewed?.n ?? 0,
    exams: out.sort((a, b) => a.at - b.at),
  };
}
