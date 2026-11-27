// Study plans on the client (step 6b, A26). The plan is encrypted here as one payload per course; the
// Worker stores ciphertext, the stage, and a version number so two tabs can't overwrite each other.

import { ApiError, api } from '../api.ts';
import { decryptText, encryptText } from '../../shared/crypto/vault.ts';
import { emptyPlan, type StudyPlan } from '../../shared/studyPlan.ts';
import { currentDataKey } from '../vault/vaultStore.ts';

export type PlanStage = 'building' | 'test_ready' | 'active' | 'failed';
export type LoadedPlan = { courseId: string; stage: PlanStage; version: number; plan: StudyPlan; updatedAt: number };
type Raw = { courseId: string; stage: PlanStage; payload: string; version: number; updatedAt: number };

function key(): CryptoKey {
  const k = currentDataKey();
  if (!k) throw new Error('Studyflare is locked.');
  return k;
}

const aad = (courseId: string) => `${courseId}#plan`;

async function open(r: Raw): Promise<LoadedPlan | null> {
  try {
    const plan = JSON.parse(await decryptText(key(), r.payload, aad(r.courseId))) as StudyPlan;
    return { courseId: r.courseId, stage: r.stage, version: r.version, plan: { ...emptyPlan(plan.courseName ?? ''), ...plan }, updatedAt: r.updatedAt };
  } catch {
    return null;
  }
}

export async function fetchPlans(): Promise<LoadedPlan[]> {
  const { plans } = await api<{ plans: Raw[] }>('GET', '/api/plans');
  return (await Promise.all(plans.map(open))).filter((p): p is LoadedPlan => p !== null);
}

export async function fetchPlan(courseId: string): Promise<LoadedPlan | null> {
  const { plan } = await api<{ plan: Raw | null }>('GET', `/api/plans/${encodeURIComponent(courseId)}`);
  return plan ? open(plan) : null;
}

/** Save; `version` is the one last read (0 for a new plan). Throws ApiError 409 if another tab saved first. */
export async function savePlan(courseId: string, stage: PlanStage, plan: StudyPlan, version: number): Promise<LoadedPlan> {
  const payload = await encryptText(key(), JSON.stringify(plan), aad(courseId));
  const r = await api<{ plan: { version: number; updatedAt: number } }>('PUT', `/api/plans/${encodeURIComponent(courseId)}`, { stage, payload, version });
  return { courseId, stage, version: r.plan.version, plan, updatedAt: r.plan.updatedAt };
}

/**
 * Read → change → save, retrying once on a conflict with the fresh copy. `change` gets the current plan
 * and returns the new stage and plan (or null to leave it).
 */
export async function updatePlan(courseId: string, change: (p: LoadedPlan) => { stage: PlanStage; plan: StudyPlan } | null): Promise<LoadedPlan | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const current = await fetchPlan(courseId);
    if (!current) return null;
    const next = change(current);
    if (!next) return current;
    try {
      return await savePlan(courseId, next.stage, next.plan, current.version);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 409) || attempt === 1) throw e;
    }
  }
  return null;
}

/** Start a plan for a course: the practice test is then made in the background. */
export async function startPlan(courseId: string, courseName: string): Promise<void> {
  try {
    await savePlan(courseId, 'building', { ...emptyPlan(courseName), build: { step: 'Waiting to start', done: 0, total: 1 } }, 0);
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) return; // already has one
    throw e;
  }
}

export const deletePlan = (courseId: string) => api('DELETE', `/api/plans/${encodeURIComponent(courseId)}`);

export const reviewStats = (courseId: string, since: number) =>
  api<{ stats: Array<{ cardId: string; reviews: number; again: number }> }>('GET', `/api/plans/${encodeURIComponent(courseId)}/review-stats?since=${since}`);
