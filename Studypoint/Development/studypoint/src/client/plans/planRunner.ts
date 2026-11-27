// The background worker for study plans (step 6b, A26). While Studyflare is open and unlocked, it checks
// every minute (and right after a course is added) for plan work and does ONE piece at a time:
//   1. a course whose practice test is still being made → carry on making it;
//   2. an active plan whose weekly re-test is due (or whose final test day has come) → make a new test;
//   3. today's and tomorrow's tasks that need a study guide, cards or a mini-quiz → make the next one;
//   4. once a day → fold card reviews into the topic scores and re-plan.
// Only one tab runs it at a time (Web Locks). Progress is shared with the UI through a tiny store.

import { dayKey, weeklyTestDue, type BuildProgress } from '../../shared/studyPlan.ts';
import { currentDataKey } from '../vault/vaultStore.ts';
import { studySnapshot } from '../studyStore.ts';
import { fetchPlans, type LoadedPlan } from './planApi.ts';
import { foldCardReviews, makeDueMaterials, makePracticeTest, missingMaterial, type CourseInfo } from './planBuilder.ts';
import { currentJob, setJob } from './planJobs.ts';

let running = false;
let timer: number | undefined;
/** A course whose job failed is left alone for a while, so a busy AI isn't hammered. */
const backoff = new Map<string, number>();
const BACKOFF_MS = 10 * 60_000;

function courseInfo(courseId: string): CourseInfo | null {
  const c = studySnapshot().courses.find((x) => x.id === courseId);
  if (!c || c.archived) return null;
  return { id: c.id, name: c.name, code: c.code, title: c.title, schoolName: c.school?.name ?? null };
}

async function work(): Promise<boolean> {
  const plans = await fetchPlans();
  const now = Date.now();
  const ready = (p: LoadedPlan) => (backoff.get(p.courseId) ?? 0) < now;
  const run = async (p: LoadedPlan, fn: (course: CourseInfo) => Promise<unknown>) => {
    const course = courseInfo(p.courseId);
    if (!course) return false;
    setJob({ courseId: p.courseId, courseName: course.name, progress: { step: 'Starting', done: 0, total: 1 } });
    try {
      await fn(course);
    } catch {
      backoff.set(p.courseId, Date.now() + BACKOFF_MS);
    } finally {
      setJob(null);
    }
    return true;
  };
  const report = (p: BuildProgress) => {
    const j = currentJob();
    if (j) setJob({ ...j, progress: p });
  };

  for (const p of plans.filter(ready)) {
    if (p.stage === 'building') return run(p, (c) => makePracticeTest(p, c, 'first', report));
  }
  const today = dayKey(now);
  for (const p of plans.filter((x) => x.stage === 'active' && ready(x))) {
    const finalDay = p.plan.days.some((d) => d.day <= today && d.tasks.some((t) => t.kind === 'test' && !t.done));
    const pendingTest = p.plan.test && !p.plan.test.takenAt;
    if (!pendingTest && (weeklyTestDue(p.plan, now) || finalDay)) return run(p, (c) => makePracticeTest(p, c, 'weekly', report));
  }
  for (const p of plans.filter((x) => x.stage === 'active' && ready(x))) {
    const soon = p.plan.days.filter((d) => d.day >= today).slice(0, 2);
    if (!soon.some((d) => d.tasks.some((t) => !t.done && missingMaterial(p.plan, t.kind, t.topicId)))) continue;
    if (await run(p, (c) => makeDueMaterials(p, c, report))) return true;
  }
  for (const p of plans.filter((x) => x.stage === 'active' && ready(x))) {
    if (await foldCardReviews(p).catch(() => false)) {
      setJob(null); // tell pages the plan changed
      return true;
    }
  }
  return false;
}

/** Look for plan work now (and keep going while there's more). */
export function kickPlans(): void {
  if (running || !currentDataKey()) return;
  running = true;
  const go = async () => {
    try {
      // Keep going while each pass did something (e.g. the next material), with a short breather.
      for (let i = 0; i < 12 && currentDataKey(); i += 1) {
        if (!(await work())) break;
        await new Promise((r) => setTimeout(r, 1500));
      }
    } catch {
      // offline or locked: try again on the next tick
    } finally {
      running = false;
    }
  };
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (locks) void locks.request('studyflare-plans', { ifAvailable: true }, async (lock) => (lock ? go() : void (running = false)));
  else void go();
}

/** Start the once-a-minute check (call once, after unlocking). Returns a stop function. */
type Stop = () => void;

export function startPlanRunner(): Stop {
  kickPlans();
  window.clearInterval(timer);
  timer = window.setInterval(kickPlans, 60_000);
  return () => window.clearInterval(timer);
}
