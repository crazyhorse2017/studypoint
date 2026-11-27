// Study plans (step 6b, A26): one per course. The test, scores and schedule are ONE encrypted payload; the
// Worker sees only the stage ('building' while the practice test is being made, 'test_ready', 'active'
// once a plan exists, 'failed'), a version number for safe concurrent saves, and times.

import { isEnvelope } from '../shared/crypto/vault.ts';

export class PlanError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'PlanError';
    this.status = status;
  }
}

export const MAX_PLAN_CHARS = 400_000;
const STAGES = ['building', 'test_ready', 'active', 'failed'] as const;
export type PlanStage = (typeof STAGES)[number];

export type StoredPlan = { courseId: string; stage: PlanStage; payload: string; version: number; createdAt: number; updatedAt: number };
type Row = { course_id: string; stage: PlanStage; payload: string; version: number; created_at: number; updated_at: number };
const toPlan = (r: Row): StoredPlan => ({ courseId: r.course_id, stage: r.stage, payload: r.payload, version: r.version, createdAt: r.created_at, updatedAt: r.updated_at });

export async function listPlans(db: D1Database, userId: string): Promise<StoredPlan[]> {
  const res = await db.prepare('SELECT course_id, stage, payload, version, created_at, updated_at FROM study_plans WHERE user_id = ? ORDER BY updated_at DESC').bind(userId).all<Row>();
  return res.results.map(toPlan);
}

export async function getPlan(db: D1Database, userId: string, courseId: string): Promise<StoredPlan | null> {
  const r = await db.prepare('SELECT course_id, stage, payload, version, created_at, updated_at FROM study_plans WHERE course_id = ? AND user_id = ?').bind(courseId, userId).first<Row>();
  return r ? toPlan(r) : null;
}

/**
 * Create or replace a course's plan. `version` is the version the browser last read (0 = none yet): if the
 * stored plan has moved on (another tab saved it), the save is refused with 409 so nothing is overwritten.
 */
export async function savePlan(db: D1Database, userId: string, courseId: string, input: unknown, now = Date.now()): Promise<StoredPlan> {
  const b = (input ?? {}) as Record<string, unknown>;
  if (!(STAGES as readonly string[]).includes(String(b['stage']))) throw new PlanError(400, 'Unknown plan stage.');
  if (!isEnvelope(b['payload']) || String(b['payload']).length > MAX_PLAN_CHARS) throw new PlanError(400, 'Study plans must be encrypted before they’re saved.');
  const expect = Number(b['version']);
  if (!Number.isInteger(expect) || expect < 0) throw new PlanError(400, 'Missing plan version.');
  if (!(await db.prepare('SELECT id FROM courses WHERE id = ? AND user_id = ?').bind(courseId, userId).first())) throw new PlanError(404, 'That course doesn’t exist.');
  const stage = String(b['stage']) as PlanStage;
  const payload = String(b['payload']);
  const res = expect === 0
    ? await db.prepare(`INSERT INTO study_plans (course_id, user_id, stage, payload, version, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)
        ON CONFLICT(course_id) DO NOTHING`).bind(courseId, userId, stage, payload, now, now).run()
    : await db.prepare('UPDATE study_plans SET stage = ?, payload = ?, version = version + 1, updated_at = ? WHERE course_id = ? AND user_id = ? AND version = ?')
      .bind(stage, payload, now, courseId, userId, expect).run();
  if ((res.meta.changes ?? 0) === 0) throw new PlanError(409, 'This plan was changed in another tab. Reload to see the latest.');
  return { courseId, stage, payload, version: expect + 1, createdAt: now, updatedAt: now };
}

export async function deletePlan(db: D1Database, userId: string, courseId: string): Promise<boolean> {
  const res = await db.prepare('DELETE FROM study_plans WHERE course_id = ? AND user_id = ?').bind(courseId, userId).run();
  return (res.meta.changes ?? 0) > 0;
}

export type CardReviewStats = { cardId: string; reviews: number; again: number };

/** Recent reviews per card in a course (for topic scores): how many, and how many were "Again". */
export async function cardReviewStats(db: D1Database, userId: string, courseId: string, since: number): Promise<CardReviewStats[]> {
  const res = await db.prepare(`SELECT r.card_id AS card_id, COUNT(*) AS n, SUM(CASE WHEN r.rating = 1 THEN 1 ELSE 0 END) AS again
    FROM review_log r JOIN cards c ON c.id = r.card_id
    WHERE r.user_id = ? AND c.user_id = ? AND c.course_id = ? AND r.reviewed_at >= ? GROUP BY r.card_id`)
    .bind(userId, userId, courseId, since).all<{ card_id: string; n: number; again: number }>();
  return res.results.map((r) => ({ cardId: r.card_id, reviews: r.n, again: r.again ?? 0 }));
}
