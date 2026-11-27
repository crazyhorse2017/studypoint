// Making a course's practice test and its plan materials (step 6b, A26). Runs in this browser (your
// material is encrypted, so nothing can do this on the server), in the background while Studyflare is
// open. Every step is saved as it finishes, so a reload carries on where it stopped.
//
// Where the questions come from: your processed files when the course has enough of them, otherwise
// trusted websites about the course (the same allowlist as web lookup). Either way every question is
// checked: its quote must be found word for word in the page it cites, and a second model must agree.

import { ApiError } from '../api.ts';
import type { QuizQuestion } from '../../shared/aiOutput.ts';
import { uuid7 } from '../../shared/uuid7.ts';
import {
  TEST_SIZE, applyScores, cardRecall, dayKey, pickBalanced, planEnd, questionsPerTopic, replan, topicScores,
  type BuildProgress, type PlanPage, type PlanQuestionExtras, type PlanTopic, type StudyPlan, type TaskKind,
} from '../../shared/studyPlan.ts';
import { generatePlan, generateTopics, webLookup } from '../ai/aiApi.ts';
import { courseOutline, inParallel, makeArticle, makeCards, makeQuiz, passagesFor, type TopicPassages } from '../ai/create.ts';
import { loadCourseIndex, type CourseIndex } from '../ai/indexer.ts';
import { uploadFile } from '../files/filesApi.ts';
import { fetchQuiz, saveQuiz, type Answered, type Quiz } from '../quizzes/quizApi.ts';
import { createCard, fetchStudySettings } from '../cards/cardsApi.ts';
import type { CardPayload } from '../../shared/cards.ts';
import { fetchPlan, reviewStats, savePlan, updatePlan, type LoadedPlan, type PlanStage } from './planApi.ts';

export type CourseInfo = { id: string; name: string; code: string | null; title: string | null; schoolName: string | null };
export type Report = (p: BuildProgress) => void;

/** At least this many processed passages before the course's own files are used instead of the web. */
const MIN_FILE_PASSAGES = 20;
const FORMATS = ['mcq', 'tf', 'numeric'];

// ---------------------------------------------------------------- saving as we go --

/** Saves one change at a time, re-reading and re-applying it if another tab saved in between. */
function writer(start: LoadedPlan) {
  let cur = start;
  let queue: Promise<void> = Promise.resolve();
  const save = (stage: PlanStage | null, change: (p: StudyPlan) => void): Promise<void> => {
    queue = queue.then(async () => {
      const apply = (base: LoadedPlan) => {
        const plan = structuredClone(base.plan);
        change(plan);
        return { stage: stage ?? base.stage, plan };
      };
      try {
        const next = apply(cur);
        cur = await savePlan(cur.courseId, next.stage, next.plan, cur.version);
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 409)) throw e;
        const fresh = await fetchPlan(cur.courseId);
        if (!fresh) throw e;
        const next = apply(fresh);
        cur = await savePlan(cur.courseId, next.stage, next.plan, fresh.version);
      }
    });
    return queue;
  };
  return { save, get: () => cur };
}

// ---------------------------------------------------------------- material --

async function trustedPages(query: string, n: number): Promise<PlanPage[]> {
  const { results } = await webLookup(query.slice(0, 380), true);
  return results
    .map((r) => ({ title: r.title, url: r.url, text: r.content.slice(0, 4000) }))
    .filter((p) => p.text.trim().length >= 200)
    .slice(0, n);
}

function webPassages(pages: readonly PlanPage[]): TopicPassages {
  const sent = pages.map((p, i) => {
    let host = '';
    try {
      host = new URL(p.url).hostname;
    } catch {
      host = '';
    }
    return { ref: `P${i + 1}`, label: `${p.title}${host ? ` (${host})` : ''}`, text: p.text, ocr: false, url: p.url };
  });
  return { sent, texts: sent.map((s) => ({ ref: s.ref, text: s.text, ocr: false })), sourcesNote: sent.map((s) => `- [${s.ref}] [${s.label}](${s.url})`).join('\n') };
}

async function courseIndex(courseId: string): Promise<CourseIndex | null> {
  try {
    const index = await loadCourseIndex(courseId);
    return index.passages.length >= MIN_FILE_PASSAGES ? index : null;
  } catch {
    return null;
  }
}

/** The passages to write about one topic: the course's files if processed, else trusted pages. */
async function topicMaterial(course: CourseInfo, plan: StudyPlan, topic: PlanTopic, index: CourseIndex | null): Promise<{ tp: TopicPassages; pages: PlanPage[] | null }> {
  if (index) return { tp: await passagesFor(index, `${topic.title}. ${topic.summary}`, [], 8), pages: null };
  const pages = plan.pages[topic.id]?.length ? (plan.pages[topic.id] as PlanPage[]) : await trustedPages(`${course.title ?? course.name}: ${topic.title}`, 3);
  if (pages.length === 0) throw new Error(`No trusted pages found about “${topic.title}”.`);
  return { tp: webPassages(pages), pages };
}

const courseQuery = (c: CourseInfo) => [c.code, c.title ?? c.name, c.schoolName].filter(Boolean).join(' ');

async function findTopics(course: CourseInfo, index: CourseIndex | null): Promise<PlanTopic[]> {
  let raw: Array<{ title: string; summary: string }>;
  if (index) {
    const { outline } = courseOutline(index);
    raw = (await generatePlan(outline, course.name)).topics.map((t) => ({ title: t.title, summary: t.summary }));
  } else {
    let pages = await trustedPages(`${courseQuery(course)} course topics syllabus`, 6);
    if (pages.length < 2) pages = [...pages, ...(await trustedPages(`${course.title ?? course.name} introduction overview`, 4))];
    if (pages.length === 0) throw new Error('No trusted websites describe this course yet. Add a file or a link to it and Studyflare will use that instead.');
    raw = (await generateTopics(webPassages(pages).sent, course.title ?? course.name, 8)).topics;
  }
  if (raw.length < 2) throw new Error('Couldn’t work out this course’s topics. Add a syllabus or some notes and try again.');
  return raw.slice(0, 10).map((t) => ({ id: uuid7(), title: t.title, summary: t.summary, score: null, evidence: 0, history: [] }));
}

// ---------------------------------------------------------------- the practice test --

/**
 * Make (or carry on making) a 20-question practice test. `kind` 'first' ends with the plan ready for the
 * test; 'weekly' keeps the plan active and swaps in the new test (weighted towards weaker topics).
 */
export async function makePracticeTest(loaded: LoadedPlan, course: CourseInfo, kind: 'first' | 'weekly', report: Report): Promise<void> {
  const w = writer(loaded);
  const stageWhile: PlanStage | null = kind === 'first' ? 'building' : null;
  const progress = async (p: BuildProgress) => {
    report(p);
    await w.save(stageWhile, (plan) => {
      plan.build = p;
    });
  };
  try {
    const index = await courseIndex(course.id);
    let plan = w.get().plan;
    if (plan.topics.length === 0) {
      await progress({ step: index ? 'Reading your files for the main topics' : 'Finding trusted pages about this course', done: 0, total: 1 });
      const topics = await findTopics(course, index);
      await w.save(stageWhile, (p) => {
        p.topics = topics;
        p.basis = index ? 'files' : 'web';
        p.draft = {};
      });
      plan = w.get().plan;
    }
    const want = questionsPerTopic(plan.topics, TEST_SIZE);
    const draft = plan.draft ?? {};
    const todo = plan.topics.filter((t) => !Array.isArray(draft[t.id]));
    let done = plan.topics.length - todo.length;
    await progress({ step: 'Writing and checking questions', done, total: plan.topics.length });
    await inParallel(todo, 3, async (t) => {
      try {
        const { tp, pages } = await topicMaterial(course, w.get().plan, t, index);
        const { accepted } = await makeQuiz(tp, t.title, Math.min(8, (want.get(t.id) ?? 2) + 1), FORMATS, 3);
        const questions = accepted.map((q) => {
          const src = tp.sent.find((s) => s.ref === q.ref);
          const extras: PlanQuestionExtras = { topicId: t.id, source: src ? { title: src.label, url: src.url } : undefined };
          return { ...q, ...extras };
        });
        await w.save(stageWhile, (p) => {
          p.draft = { ...(p.draft ?? {}), [t.id]: questions };
          if (pages) p.pages = { ...p.pages, [t.id]: pages };
        });
      } catch (e) {
        // One topic failing (no pages, the AI busy) shouldn't stop the rest; it just gets no questions.
        await w.save(stageWhile, (p) => {
          p.draft = { ...(p.draft ?? {}), [t.id]: [] };
        });
        if (e instanceof Error && /allowance/i.test(e.message)) throw e;
      }
      done += 1;
      await progress({ step: 'Writing and checking questions', done, total: plan.topics.length });
    });
    plan = w.get().plan;
    const byTopic = plan.topics.map((t) => ({ topicId: t.id, items: ((plan.draft ?? {})[t.id] ?? []) as Array<QuizQuestion & PlanQuestionExtras> }));
    const picked = pickBalanced(byTopic, want, TEST_SIZE);
    if (picked.length < 8) throw new Error('Not enough questions passed the checks to make a fair test. Add a file or link to this course and try again.');
    await progress({ step: 'Saving the test', done: plan.topics.length, total: plan.topics.length });
    const quizId = await saveQuiz(course.id, kind === 'first' ? `Practice test: ${course.name}` : `Weekly check-in: ${course.name}`, picked.map((p) => p.item));
    await w.save(kind === 'first' ? 'test_ready' : null, (p) => {
      if (p.test) p.pastTests = [...p.pastTests, p.test].slice(-20);
      p.test = { quizId, kind, madeAt: Date.now(), takenAt: null, score: null };
      delete p.draft;
      delete p.build;
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Something went wrong.';
    report({ step: 'Stopped', done: 0, total: 1, error: message });
    await w.save(kind === 'first' ? 'failed' : null, (p) => {
      p.build = { step: 'Stopped', done: 0, total: 1, error: message };
      if (kind === 'weekly') delete p.draft;
    }).catch(() => undefined);
    // A weekly test stays "active", so rethrow: the runner then waits before trying again.
    if (kind === 'weekly') throw e;
  }
}

// ---------------------------------------------------------------- results → scores → plan --

async function examFor(courseId: string): Promise<number | null> {
  try {
    return (await fetchStudySettings()).exams.find((e) => e.courseId === courseId)?.at ?? null;
  } catch {
    return null;
  }
}

/** After a quiz is submitted: if it's one of a plan's quizzes, update the topic scores and the plan. */
export async function recordQuizInPlan(quiz: Quiz, answered: readonly Answered[]): Promise<void> {
  if (!quiz.courseId) return;
  const topicOf = new Map(quiz.questions.map((q) => [q.id, (q.question as (QuizQuestion & Partial<PlanQuestionExtras>) | null)?.topicId ?? '']));
  const results = answered.map((a) => ({ topicId: topicOf.get(a.questionId) ?? '', score: a.finalScore })).filter((r) => r.topicId);
  if (results.length === 0) return;
  const examAt = await examFor(quiz.courseId);
  const now = Date.now();
  await updatePlan(quiz.courseId, (lp) => {
    const plan = structuredClone(lp.plan);
    if (plan.counted.includes(quiz.id)) return null;
    const isTest = plan.test?.quizId === quiz.id;
    plan.topics = applyScores(plan.topics, topicScores(results), isTest ? 'test' : 'quiz', now);
    plan.counted = [...plan.counted, quiz.id].slice(-200);
    if (isTest && plan.test) plan.test = { ...plan.test, takenAt: now, score: results.reduce((n, r) => n + r.score, 0) / results.length };
    const today = dayKey(now);
    // Tick off the task this quiz was for.
    for (const d of plan.days) {
      for (const t of d.tasks) {
        if (t.done) continue;
        if (isTest && t.kind === 'test' && d.day <= today) t.done = true;
        if (!isTest && t.kind === 'quiz' && t.topicId && plan.materials[t.topicId]?.quizIds?.includes(quiz.id)) t.done = true;
      }
    }
    plan.days = replan(plan, today, planEnd(today, examAt));
    return { stage: 'active', plan };
  });
}

/** Mark a task done (or not). */
export async function setTaskDone(courseId: string, day: string, kind: TaskKind, topicId: string | null, done: boolean): Promise<void> {
  await updatePlan(courseId, (lp) => {
    const plan = structuredClone(lp.plan);
    const task = plan.days.find((d) => d.day === day)?.tasks.find((t) => t.kind === kind && t.topicId === topicId);
    if (!task || task.done === done) return null;
    task.done = done;
    return { stage: lp.stage, plan };
  });
}

// ---------------------------------------------------------------- materials, just in time --

/** What a task needs made, if anything: guide → a study guide; cards/review → cards for the tray; quiz → a mini-quiz. */
export function missingMaterial(plan: StudyPlan, kind: TaskKind, topicId: string | null): 'guide' | 'cards' | 'quiz' | null {
  if (!topicId) return null;
  const m = plan.materials[topicId] ?? {};
  // "Tried" counts as made (an empty tray or quiz list), so a topic the AI can't write for isn't retried forever.
  if (kind === 'guide' && !m.guideFileId) return 'guide';
  if ((kind === 'cards' || kind === 'review') && m.tray === undefined && m.cardIds === undefined) return 'cards';
  if (kind === 'quiz' && m.quizIds === undefined) return 'quiz';
  return null;
}

/**
 * Make what today's and tomorrow's tasks need, one item at a time (so it uses the AI allowance only for
 * days that are close, and the plan page fills in as it goes). Returns true if it made something.
 */
export async function makeDueMaterials(loaded: LoadedPlan, course: CourseInfo, report: Report): Promise<boolean> {
  const today = dayKey(Date.now());
  const soon = loaded.plan.days.filter((d) => d.day >= today).slice(0, 2);
  const needs = soon.flatMap((d) => d.tasks.filter((t) => !t.done).map((t) => ({ t, need: missingMaterial(loaded.plan, t.kind, t.topicId) }))).filter((x) => x.need);
  const first = needs[0];
  if (!first || !first.t.topicId) return false;
  const topic = loaded.plan.topics.find((x) => x.id === first.t.topicId);
  if (!topic) return false;
  const index = await courseIndex(course.id);
  const label = { guide: 'study guide', cards: 'flashcards', quiz: 'mini-quiz' }[first.need as 'guide' | 'cards' | 'quiz'];
  report({ step: `Making a ${label} for “${topic.title}”`, done: 0, total: needs.length });
  const { tp, pages } = await topicMaterial(course, loaded.plan, topic, index);
  const w = writer(loaded);
  if (first.need === 'guide') {
    const { title, markdown } = await makeArticle(tp, topic.title, 'short', index ? 'your own material' : 'trusted web pages (listed at the end)');
    const fileId = await uploadFile(new File([markdown], `${title.slice(0, 100)}.md`, { type: 'text/markdown' }), course.id, undefined, 'ai');
    await w.save(null, (p) => {
      p.materials[topic.id] = { ...(p.materials[topic.id] ?? {}), guideFileId: fileId };
      if (pages) p.pages = { ...p.pages, [topic.id]: pages };
    });
  } else if (first.need === 'cards') {
    const { accepted } = await makeCards(tp, topic.title, 8, ['basic', 'typed', 'cloze']);
    const tray = accepted.map(({ card }) => {
      const source = tp.sent.find((s) => s.ref === card.ref)?.label ?? '';
      return card.kind === 'cloze'
        ? { kind: 'cloze' as const, front: '', back: card.extra, text: card.text, quote: card.quote, source }
        : { kind: card.kind, front: card.front, back: card.back, quote: card.quote, source };
    });
    await w.save(null, (p) => {
      // An empty tray still records that it was tried, so it isn't retried in a loop.
      p.materials[topic.id] = { ...(p.materials[topic.id] ?? {}), tray };
    });
  } else {
    const { accepted } = await makeQuiz(tp, topic.title, 5, FORMATS, 3);
    const qs = accepted.map((q) => ({ ...q, topicId: topic.id }));
    const quizId = qs.length ? await saveQuiz(course.id, `Re-check: ${topic.title}`, qs) : null;
    await w.save(null, (p) => {
      const m = p.materials[topic.id] ?? {};
      p.materials[topic.id] = { ...m, quizIds: [...(m.quizIds ?? []), ...(quizId ? [quizId] : [])] };
    });
  }
  return true;
}

/** Approve tray cards (by position) into the course; the rest of the tray stays unless `discardRest`. */
export async function approveTray(courseId: string, topicId: string, keep: readonly number[], discardRest: boolean): Promise<number> {
  const current = await fetchPlan(courseId);
  const tray = current?.plan.materials[topicId]?.tray ?? [];
  const chosen = keep.map((i) => tray[i]).filter((x): x is NonNullable<typeof x> => Boolean(x));
  const ids: string[] = [];
  for (const c of chosen) {
    const payload: CardPayload = c.kind === 'cloze'
      ? { type: 'cloze', text: c.text ?? '', extra: c.back }
      : { type: 'basic', front: c.front, back: c.back, reversible: false, answerMode: c.kind === 'typed' ? 'typed' : 'reveal' };
    ids.push(await createCard(courseId, payload));
  }
  const keepSet = new Set(keep);
  await updatePlan(courseId, (lp) => {
    const plan = structuredClone(lp.plan);
    const m = plan.materials[topicId] ?? {};
    plan.materials[topicId] = { ...m, cardIds: [...(m.cardIds ?? []), ...ids], tray: discardRest ? [] : (m.tray ?? []).filter((_, i) => !keepSet.has(i)) };
    for (const d of plan.days) for (const t of d.tasks) if (t.topicId === topicId && (t.kind === 'cards' || t.kind === 'review') && d.day <= dayKey(Date.now()) && ids.length) t.done = true;
    return { stage: lp.stage, plan };
  });
  return ids.length;
}

/** Once a day: fold recent card reviews into topic scores, and re-plan the days ahead. */
export async function foldCardReviews(loaded: LoadedPlan): Promise<boolean> {
  const now = Date.now();
  const last = loaded.plan.cardsCountedAt;
  if (last && now - last < 86_400_000) return false;
  const withCards = loaded.plan.topics.filter((t) => loaded.plan.materials[t.id]?.cardIds?.length);
  if (withCards.length === 0) {
    if (!last) await updatePlan(loaded.courseId, (lp) => ({ stage: lp.stage, plan: { ...lp.plan, cardsCountedAt: now } }));
    return false;
  }
  const { stats } = await reviewStats(loaded.courseId, last ?? now - 14 * 86_400_000);
  const byCard = new Map(stats.map((s) => [s.cardId, s]));
  const scores = new Map<string, { score: number; n: number }>();
  for (const t of withCards) {
    const r = cardRecall((loaded.plan.materials[t.id]?.cardIds ?? []).map((id) => byCard.get(id)).filter((s): s is NonNullable<typeof s> => Boolean(s)));
    if (r) scores.set(t.id, r);
  }
  const examAt = await examFor(loaded.courseId);
  await updatePlan(loaded.courseId, (lp) => {
    const plan = structuredClone(lp.plan);
    plan.cardsCountedAt = now;
    if (scores.size) {
      plan.topics = applyScores(plan.topics, scores, 'cards', now);
      const today = dayKey(now);
      plan.days = replan(plan, today, planEnd(today, examAt));
    }
    return { stage: lp.stage, plan };
  });
  return scores.size > 0;
}

/** Re-read a quiz (for the plan page's score breakdown). */
export const openQuiz = fetchQuiz;
