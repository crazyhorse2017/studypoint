// Step 6b: study plans and faster generation (A26).
// - Topic scores: averaging, blending new evidence, card recall only with enough reviews.
// - The schedule: weak topics first with a re-check quiz later, strong topics reviewed, a final test,
//   every day inside the plan's range, and re-planning keeps the past and what's done today.
// - Question counts per topic add up to the test size; balanced picking fills gaps.
// - Batching splits big requests into parallel batches with separate passages.
// - The Worker stores plans as ciphertext only and refuses a stale save (409).
// - Web lookup can return a page's full text, still only from allowed sites.

import {
  TEST_SIZE, addDays, applyScores, blend, buildSchedule, cardRecall, dayKey, daysBetween, emptyPlan, pickBalanced, planEnd,
  questionsPerTopic, replan, topicScores, weeklyTestDue, type PlanTopic,
} from '../../src/shared/studyPlan.ts';
import { parseTopics } from '../../src/shared/aiOutput.ts';
import { batchPlan } from '../../src/shared/batching.ts';
import { encryptText, importDataKey, randomBytes } from '../../src/shared/crypto/vault.ts';
import { PlanError, savePlan } from '../../src/worker/studyPlans.ts';
import { trustedSearch } from '../../src/worker/ai/lookup.ts';

type TestFn = (name: string, fn: () => void | Promise<void>) => void;
type Assert = { ok(c: unknown, m?: string): void; equal(a: unknown, b: unknown, m?: string): void; deepEqual(a: unknown, b: unknown, m?: string): void };

const topic = (id: string, score: number | null): PlanTopic => ({ id, title: `Topic ${id}`, summary: '', score, evidence: score === null ? 0 : 3, history: [] });

function fakePlanDb() {
  const rows = new Map<string, { user: string; stage: string; payload: string; version: number }>();
  const stmt = (sql: string, a: unknown[] = []) => ({
    sql, a,
    bind: (...args: unknown[]) => stmt(sql, args),
    async first() {
      if (sql.startsWith('SELECT id FROM courses')) return a[0] === 'c1' && a[1] === 'u1' ? { id: 'c1' } : null;
      throw new Error('unexpected first: ' + sql);
    },
    async run() {
      if (sql.startsWith('INSERT INTO study_plans')) {
        if (rows.has(a[0] as string)) return { meta: { changes: 0 } };
        rows.set(a[0] as string, { user: a[1] as string, stage: a[2] as string, payload: a[3] as string, version: 1 });
        return { meta: { changes: 1 } };
      }
      if (sql.startsWith('UPDATE study_plans')) {
        const r = rows.get(a[3] as string);
        if (!r || r.user !== a[4] || r.version !== a[5]) return { meta: { changes: 0 } };
        Object.assign(r, { stage: a[0], payload: a[1], version: r.version + 1 });
        return { meta: { changes: 1 } };
      }
      throw new Error('unexpected run: ' + sql);
    },
  });
  return { db: { prepare: (sql: string) => stmt(sql) } as unknown as D1Database, rows };
}

async function status(p: Promise<unknown>): Promise<number> {
  try { await p; return 0; } catch (e) { return e instanceof PlanError ? e.status : -1; }
}

export function register(test: TestFn, assert: Assert): void {
  test('plan scores: averages per topic, recent evidence counts, card recall needs 5+ reviews', () => {
    const s = topicScores([{ topicId: 'a', score: 1 }, { topicId: 'a', score: 0 }, { topicId: 'b', score: 1 }, { topicId: 'b', score: 2 }]);
    assert.equal(s.get('a')?.score, 0.5);
    assert.equal(s.get('b')?.score, 1, 'scores are clamped to 1');
    assert.equal(blend(null, 0, 0.3, 4), 0.3, 'the first evidence counts in full');
    const up = blend(0.2, 20, 1, 1);
    assert.ok(up >= 0.2 + 0.8 * 0.4 - 1e-9, 'a new result moves the score at least 40%');
    const ts = applyScores([topic('a', null), topic('b', 0.9)], s, 'test', 1);
    assert.equal(ts[0]?.score, 0.5);
    assert.equal(ts[0]?.history.length, 1);
    assert.equal(cardRecall([{ reviews: 3, again: 1 }]), null);
    assert.deepEqual(cardRecall([{ reviews: 8, again: 2 }, { reviews: 2, again: 0 }]), { score: 0.8, n: 1 });
  });

  test('schedule: weak first with a later re-check, strong reviewed, final test, all inside the range', () => {
    const start = '2026-12-01';
    const end = '2026-12-15';
    const topics = [topic('weak1', 0.2), topic('weak2', 0.5), topic('strong', 0.95), topic('new', null)];
    const days = buildSchedule(topics, start, end);
    assert.equal(days.length, 14);
    assert.equal(days[0]?.day, start);
    assert.equal(days[13]?.day, addDays(start, 13));
    const where = (kind: string, id: string | null) => days.findIndex((d) => d.tasks.some((t) => t.kind === kind && t.topicId === id));
    for (const id of ['weak1', 'weak2', 'new']) {
      assert.ok(where('guide', id) >= 0 && where('cards', id) === where('guide', id), `${id} gets a learn day`);
      assert.ok(where('quiz', id) > where('guide', id), `${id} is re-checked after it's learned`);
    }
    assert.ok(where('guide', 'new') <= where('guide', 'weak1') && where('guide', 'weak1') <= where('guide', 'weak2'), 'untested and weakest come first');
    assert.equal(where('guide', 'strong'), -1, 'strong topics aren’t re-taught');
    assert.ok(where('review', 'strong') >= 0);
    assert.ok(days[13]?.tasks.some((t) => t.kind === 'test'), 'a full practice test on the last day');
    const short = buildSchedule(topics, start, '2026-12-02');
    assert.equal(short.length, 3, 'at least 3 days');
    assert.ok(short.every((d) => d.day < addDays(start, 3)));
  });

  test('replan keeps past days and what is done today; plan end uses the exam when it’s 3+ days off', () => {
    const plan = emptyPlan('X');
    plan.topics = [topic('a', 0.3), topic('b', 0.4)];
    plan.days = buildSchedule(plan.topics, '2026-12-01', '2026-12-15');
    plan.days[2]?.tasks.forEach((t) => { t.done = true; });
    const doneToday = plan.days[2]?.tasks.length ?? 0;
    plan.topics = [topic('a', 0.95), topic('b', 0.4)];
    const next = replan(plan, '2026-12-03', '2026-12-15');
    assert.deepEqual(next.slice(0, 2), plan.days.slice(0, 2), 'past days kept as they were');
    assert.equal(next[2]?.day, '2026-12-03');
    assert.equal(next[2]?.tasks.filter((t) => t.done).length, doneToday, 'done tasks today kept');
    assert.ok(!next.slice(3).some((d) => d.tasks.some((t) => t.kind === 'guide' && t.topicId === 'a')), 'a topic that improved isn’t re-taught');
    const today = '2026-12-01';
    assert.equal(planEnd(today, new Date(2026, 11, 10, 9).getTime()), '2026-12-10');
    assert.equal(planEnd(today, new Date(2026, 11, 2, 9).getTime()), addDays(today, 14), 'an exam tomorrow falls back to 14 days');
    assert.equal(planEnd(today, null), addDays(today, 14));
    assert.equal(daysBetween('2026-12-30', '2027-01-02'), 3);
    assert.equal(dayKey(new Date(2026, 0, 5, 23, 59).getTime()), '2026-01-05');
  });

  test('test size: per-topic counts add up to 20 and favour weak topics; picking fills gaps', () => {
    const fresh = questionsPerTopic([topic('a', null), topic('b', null), topic('c', null)], TEST_SIZE);
    assert.equal([...fresh.values()].reduce((n, x) => n + x, 0), TEST_SIZE);
    const weighted = questionsPerTopic([topic('weak', 0.1), topic('strong', 0.95), topic('mid', 0.6)], TEST_SIZE);
    assert.equal([...weighted.values()].reduce((n, x) => n + x, 0), TEST_SIZE);
    assert.ok((weighted.get('weak') ?? 0) > (weighted.get('strong') ?? 0));
    const many = questionsPerTopic(Array.from({ length: 25 }, (_, i) => topic(`t${i}`, null)), TEST_SIZE);
    assert.ok([...many.values()].every((n) => n >= 1), 'every topic gets at least one');
    const picked = pickBalanced([{ topicId: 'a', items: [1, 2] }, { topicId: 'b', items: [3, 4, 5, 6, 7] }], new Map([['a', 3], ['b', 3]]), 6);
    assert.equal(picked.length, 6, 'a topic short of questions is made up from another');
    assert.equal(picked.filter((p) => p.topicId === 'a').length, 2);
    const plan = emptyPlan('X');
    assert.equal(weeklyTestDue(plan, Date.now()), false);
    plan.test = { quizId: 'q', kind: 'first', madeAt: 0, takenAt: Date.now() - 8 * 86_400_000, score: 0.5 };
    assert.equal(weeklyTestDue(plan, Date.now()), true);
  });

  test('batching: 20 items become 4 batches of 5 with separate passages; small asks stay one', () => {
    const b = batchPlan(20, 10);
    assert.equal(b.length, 4);
    assert.equal(b.reduce((n, x) => n + x.count, 0), 20);
    const seen = b.flatMap((x) => x.passageIdx);
    assert.equal(new Set(seen).size, seen.length, 'no passage is shared between batches');
    assert.equal(seen.length, 10);
    assert.deepEqual(batchPlan(4, 3), [{ count: 4, passageIdx: [0, 1, 2] }]);
    const few = batchPlan(12, 3);
    assert.ok(few.every((x) => x.passageIdx.length === 3), 'too few passages to split: each batch gets all');
    assert.equal(few.reduce((n, x) => n + x.count, 0), 12);
  });

  test('topics: parsed, trimmed and de-duplicated', () => {
    const t = parseTopics({ topics: [{ title: 'Limits', summary: 's' }, { title: 'limits' }, { name: 'Derivatives' }, { title: '' }] });
    assert.deepEqual(t.map((x) => x.title), ['Limits', 'Derivatives']);
  });

  test('plans (worker): ciphertext only, own course only, and a stale save is refused', async () => {
    const { db, rows } = fakePlanDb();
    const k = await importDataKey(randomBytes(32));
    const payload = await encryptText(k, '{"v":1}', 'c1#plan');
    assert.equal(await status(savePlan(db, 'u1', 'c1', { stage: 'building', payload: '{"v":1}', version: 0 })), 400, 'plaintext');
    assert.equal(await status(savePlan(db, 'u1', 'c1', { stage: 'nope', payload, version: 0 })), 400, 'unknown stage');
    assert.equal(await status(savePlan(db, 'u1', 'c9', { stage: 'building', payload, version: 0 })), 404, 'someone else’s course');
    const a = await savePlan(db, 'u1', 'c1', { stage: 'building', payload, version: 0 });
    assert.equal(a.version, 1);
    assert.equal(await status(savePlan(db, 'u1', 'c1', { stage: 'building', payload, version: 0 })), 409, 'creating twice');
    const b = await savePlan(db, 'u1', 'c1', { stage: 'active', payload, version: 1 });
    assert.equal(b.version, 2);
    assert.equal(await status(savePlan(db, 'u1', 'c1', { stage: 'active', payload, version: 1 })), 409, 'a save based on an old version');
    assert.equal(rows.get('c1')?.stage, 'active');
  });

  test('lookup: full page text on request, snippets otherwise, untrusted sites still dropped', async () => {
    let body: Record<string, unknown> = {};
    const fake = (async (_url: string, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ results: [
        { url: 'https://openstax.org/books/x', title: 'Open text', content: 'short snippet', raw_content: 'The full page text. '.repeat(50) },
        { url: 'https://www.chegg.com/x', title: 'Blocked', content: 'answers', raw_content: 'answers' },
      ] }), { status: 200 });
    }) as unknown as typeof fetch;
    const raw = await trustedSearch('key', 'thermal resistance', fake, { raw: true });
    assert.equal(body['include_raw_content'], true);
    assert.equal(raw.length, 1, 'blocked site removed');
    assert.ok((raw[0]?.content.length ?? 0) > 500, 'full text returned');
    const plain = await trustedSearch('key', 'thermal resistance', fake);
    assert.equal(body['include_raw_content'], false);
    assert.equal(plain[0]?.content, 'short snippet');
  });
}
