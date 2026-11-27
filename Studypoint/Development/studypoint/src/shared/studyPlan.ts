// Study plans (step 6b, A26). Pure: what a plan holds, how topic scores move, and how the day-by-day
// schedule is laid out. The whole plan is encrypted as ONE payload per course in the browser.
//
// Flow: a course is added → a 20-question practice test is made from trusted web pages about it (or from
// your files, once they're processed) → you take it → each topic gets a score → a schedule to the exam
// (or 14 days) puts weak topics first: read a study guide + learn cards, then a mini-quiz 2–3 days later.
// Strong topics get one review day. Scores keep moving with your quizzes and card reviews, a fresh
// practice test is offered each week, and the days ahead are re-planned from the new scores.

export const TEST_SIZE = 20;
/** Below this a topic is "weak" and gets a guide, cards and a re-check quiz. */
export const WEAK = 0.7;
export const DEFAULT_DAYS = 14;
export const MAX_DAYS = 60;
export const WEEK_MS = 7 * 86_400_000;

export type TopicScoreSource = 'test' | 'quiz' | 'cards';
export type PlanTopic = {
  id: string;
  title: string;
  summary: string;
  /** 0–1, null until there's evidence. */
  score: number | null;
  /** How many answered questions (or review batches) the score rests on. */
  evidence: number;
  history: Array<{ at: number; score: number; from: TopicScoreSource }>;
};

/** A trusted web page used to make the test and the materials (title + URL + text). */
export type PlanPage = { title: string; url: string; text: string };

export type TaskKind = 'guide' | 'cards' | 'quiz' | 'review' | 'test';
export type PlanTask = { kind: TaskKind; topicId: string | null; done: boolean };
export type PlanDay = { day: string; tasks: PlanTask[] };

export type TopicMaterials = {
  /** The study guide (a Markdown file in the course). */
  guideFileId?: string;
  /** Cards made for this topic, waiting in the tray until approved (encrypted with the plan). */
  tray?: Array<{ front: string; back: string; kind: 'basic' | 'typed' | 'cloze'; text?: string; quote: string; source: string }>;
  /** Cards approved into the course (their reviews feed the topic score). */
  cardIds?: string[];
  /** Mini-quizzes made for this topic. */
  quizIds?: string[];
};

/** A practice test. Each question's topic is stored inside its own encrypted payload (`topicId`). */
export type PlanTest = { quizId: string; kind: 'first' | 'weekly'; madeAt: number; takenAt: number | null; score: number | null };

/** A question as saved in a plan's quizzes: a normal quiz question plus its topic and where it came from. */
export type PlanQuestionExtras = { topicId: string; source?: { title: string; url?: string } };

export type BuildProgress = { step: string; done: number; total: number; error?: string };

export type StudyPlan = {
  v: 1;
  courseName: string;
  /** Where the test and materials came from. */
  basis: 'web' | 'files';
  topics: PlanTopic[];
  pages: Record<string, PlanPage[]>;
  /** The current (latest) practice test. */
  test: PlanTest | null;
  /** Practice tests already taken. */
  pastTests: PlanTest[];
  days: PlanDay[];
  materials: Record<string, TopicMaterials>;
  /** While a test is being made: the questions written so far per topic (so a reload resumes). */
  draft?: Record<string, unknown[]>;
  build?: BuildProgress;
  /** Quiz ids already counted into the scores (so an attempt is counted once). */
  counted: string[];
  /** When card reviews were last folded into the scores. */
  cardsCountedAt: number | null;
};

export function emptyPlan(courseName: string): StudyPlan {
  return { v: 1, courseName, basis: 'web', topics: [], pages: {}, test: null, pastTests: [], days: [], materials: {}, counted: [], cardsCountedAt: null };
}

// ---------------------------------------------------------------- dates (local days) --

export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return dayKey(new Date(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + n, 12).getTime());
}

export function daysBetween(a: string, b: string): number {
  const t = (s: string) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  };
  return Math.round((t(b) - t(a)) / 86_400_000);
}

// ---------------------------------------------------------------- scores --

/** Average score per topic from graded questions. */
export function topicScores(results: ReadonlyArray<{ topicId: string; score: number }>): Map<string, { score: number; n: number }> {
  const sum = new Map<string, { total: number; n: number }>();
  for (const r of results) {
    const s = sum.get(r.topicId) ?? { total: 0, n: 0 };
    s.total += Math.min(1, Math.max(0, r.score));
    s.n += 1;
    sum.set(r.topicId, s);
  }
  return new Map([...sum].map(([k, v]) => [k, { score: v.total / v.n, n: v.n }]));
}

/**
 * Fold new evidence into a topic's score. Recent evidence counts more: the new result's weight is its
 * share of the evidence, but at least 40% (so improvement shows), and a practice test counts in full
 * the first time.
 */
export function blend(old: number | null, oldN: number, next: number, n: number): number {
  if (old === null || oldN === 0) return next;
  const w = Math.max(0.4, n / (n + oldN));
  return Math.min(1, Math.max(0, old * (1 - w) + next * w));
}

export function applyScores(topics: readonly PlanTopic[], scores: Map<string, { score: number; n: number }>, from: TopicScoreSource, at: number): PlanTopic[] {
  return topics.map((t) => {
    const s = scores.get(t.id);
    if (!s) return t;
    const score = blend(t.score, t.evidence, s.score, s.n);
    return { ...t, score, evidence: Math.min(50, t.evidence + s.n), history: [...t.history, { at, score, from }].slice(-30) };
  });
}

/** Recall on a topic's cards (1 − share of "Again"), once there are at least 5 reviews. */
export function cardRecall(stats: ReadonlyArray<{ reviews: number; again: number }>): { score: number; n: number } | null {
  const reviews = stats.reduce((n, s) => n + s.reviews, 0);
  if (reviews < 5) return null;
  const again = stats.reduce((n, s) => n + s.again, 0);
  // Card reviews are lighter evidence than quiz answers: 10 reviews count as one answered question.
  return { score: 1 - again / reviews, n: Math.max(1, Math.round(reviews / 10)) };
}

export const isWeak = (t: PlanTopic) => t.score !== null && t.score < WEAK;

// ---------------------------------------------------------------- schedule --

/**
 * Lay out the days from `start` (inclusive) to `end` (exclusive; the exam day, or start + 14):
 * - weak topics, weakest first, each get a "learn" day (guide + cards), then a re-check quiz 2–3 days
 *   later; at most 2 learn topics a day, spread over the first ~2/3 of the time;
 * - strong topics get one review day in the last third;
 * - the day before the end gets a full practice test.
 * Topics with no score yet are treated as weak (you haven't shown you know them).
 */
export function buildSchedule(topics: readonly PlanTopic[], start: string, end: string): PlanDay[] {
  const total = Math.max(3, Math.min(MAX_DAYS, daysBetween(start, end)));
  const days: PlanDay[] = Array.from({ length: total }, (_, i) => ({ day: addDays(start, i), tasks: [] }));
  const at = (i: number) => days[Math.min(days.length - 1, Math.max(0, i))] as PlanDay;
  const weak = topics.filter((t) => t.score === null || t.score < WEAK).sort((a, b) => (a.score ?? -1) - (b.score ?? -1));
  const strong = topics.filter((t) => t.score !== null && t.score >= WEAK).sort((a, b) => (a.score ?? 0) - (b.score ?? 0));
  const learnSpan = Math.max(1, Math.floor((total - 1) * 2 / 3));
  const perDay = Math.max(1, Math.min(2, Math.ceil(weak.length / learnSpan)));
  const slots = Math.max(1, Math.ceil(weak.length / perDay));
  const spacing = Math.max(1, Math.floor(learnSpan / slots));
  weak.forEach((t, i) => {
    const learn = Math.min(learnSpan - 1, Math.floor(i / perDay) * spacing);
    at(learn).tasks.push({ kind: 'guide', topicId: t.id, done: false }, { kind: 'cards', topicId: t.id, done: false });
    at(Math.min(total - 2, learn + (total >= 8 ? 3 : 2))).tasks.push({ kind: 'quiz', topicId: t.id, done: false });
  });
  const reviewFrom = Math.max(learnSpan, 0);
  strong.forEach((t, i) => {
    const span = Math.max(1, total - 1 - reviewFrom);
    at(reviewFrom + (i % span)).tasks.push({ kind: 'review', topicId: t.id, done: false });
  });
  at(total - 1).tasks.push({ kind: 'test', topicId: null, done: false });
  return days;
}

/**
 * Re-plan the days from `today` on with the current scores, keeping earlier days as they were and
 * keeping any task already done today.
 */
export function replan(plan: StudyPlan, today: string, end: string): PlanDay[] {
  const past = plan.days.filter((d) => d.day < today);
  const doneToday = plan.days.find((d) => d.day === today)?.tasks.filter((t) => t.done) ?? [];
  const ahead = buildSchedule(plan.topics, today, end <= today ? addDays(today, DEFAULT_DAYS) : end);
  const first = ahead[0];
  if (first && first.day === today) {
    const key = (t: PlanTask) => `${t.kind}:${t.topicId ?? ''}`;
    const kept = new Set(doneToday.map(key));
    first.tasks = [...doneToday, ...first.tasks.filter((t) => !kept.has(key(t)))];
  }
  return [...past, ...ahead];
}

/** The end of the plan: the exam day if it's ahead, else 14 days from today. */
export function planEnd(today: string, examAt: number | null): string {
  if (examAt) {
    const exam = dayKey(examAt);
    if (daysBetween(today, exam) >= 3) return exam;
  }
  return addDays(today, DEFAULT_DAYS);
}

/** A week since the last practice test was taken: time for a fresh one. */
export const weeklyTestDue = (plan: StudyPlan, now: number): boolean => Boolean(plan.test?.takenAt && now - plan.test.takenAt >= WEEK_MS);

/**
 * How many questions per topic for a test of `size`: an even share, with more for weaker topics on a
 * weekly re-test (scores known), and at least 1 each.
 */
export function questionsPerTopic(topics: readonly PlanTopic[], size = TEST_SIZE): Map<string, number> {
  const out = new Map<string, number>();
  if (topics.length === 0) return out;
  const weight = (t: PlanTopic) => (t.score === null ? 1 : 0.5 + (1 - t.score));
  const total = topics.reduce((n, t) => n + weight(t), 0);
  let left = size;
  topics.forEach((t) => {
    const n = Math.max(1, Math.round((weight(t) / total) * size));
    out.set(t.id, n);
    left -= n;
  });
  // Fix rounding so the total is exactly `size` (add to / take from the weakest topics first).
  const order = [...topics].sort((a, b) => (a.score ?? -1) - (b.score ?? -1));
  for (let i = 0; left !== 0 && i < 200; i += 1) {
    const t = order[i % order.length] as PlanTopic;
    const n = out.get(t.id) ?? 1;
    if (left > 0) {
      out.set(t.id, n + 1);
      left -= 1;
    } else if (n > 1) {
      out.set(t.id, n - 1);
      left += 1;
    }
  }
  return out;
}

/** Pick `size` questions balanced across topics from what was written (each list in order). */
export function pickBalanced<T>(byTopic: ReadonlyArray<{ topicId: string; items: readonly T[] }>, want: Map<string, number>, size = TEST_SIZE): Array<{ topicId: string; item: T }> {
  const out: Array<{ topicId: string; item: T }> = [];
  const used = new Map<string, number>();
  for (const { topicId, items } of byTopic) {
    const n = Math.min(items.length, want.get(topicId) ?? 0);
    items.slice(0, n).forEach((item) => out.push({ topicId, item }));
    used.set(topicId, n);
  }
  // Fill any gap from topics that have spare questions.
  for (const { topicId, items } of byTopic) {
    let i = used.get(topicId) ?? 0;
    while (out.length < size && i < items.length) {
      out.push({ topicId, item: items[i] as T });
      i += 1;
    }
  }
  return out.slice(0, size);
}
