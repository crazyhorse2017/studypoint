// RRF + FTS query safety (A6), OCR classifier (LIB-04), passage diff (SRC-01), daily budget (CRD-06).

import { ftsQuery, reciprocalRankFusion } from '../../src/shared/retrieval.ts';
import { classifyPageText } from '../../src/shared/ocrClassify.ts';
import { diffPassages, normaliseForHash, type DiffPassage } from '../../src/shared/passageDiff.ts';
import { MAX_NEW_PER_DAY, median, planDailyBudget } from '../../src/shared/budget.ts';

type TestFn = (name: string, fn: () => void | Promise<void>) => void;
type Assert = { ok(c: unknown, m?: string): void; equal(a: unknown, b: unknown, m?: string): void; deepEqual(a: unknown, b: unknown, m?: string): void };

const prose = 'The first law of thermodynamics says that energy is conserved in every closed system, so heat added equals the change in internal energy plus the work done by the system on its surroundings. ';

export function register(test: TestFn, assert: Assert): void {
  test('rrf: items found by both lists rise to the top; duplicates count once per list', () => {
    const fused = reciprocalRankFusion([['a', 'b', 'c', 'c'], ['c', 'd', 'a']]);
    assert.deepEqual(fused.map((x) => x.id), ['a', 'c', 'b', 'd']);
    assert.ok(Math.abs((fused[0]?.score ?? 0) - (1 / 61 + 1 / 63)) < 1e-12);
    assert.deepEqual(reciprocalRankFusion([]), []);
  });

  test('fts: user text becomes a quoted OR query; FTS syntax cannot be injected', () => {
    assert.equal(ftsQuery('Entropy, entropy and HEAT!'), '"entropy" OR "and" OR "heat"');
    const q = ftsQuery('text: NEAR(a b) "x" OR *') ?? '';
    assert.ok(!/NEAR\(|\*|:/.test(q.replace(/"[^"]*"/g, '')), `unquoted syntax leaked: ${q}`);
    assert.equal(ftsQuery('  ?!  '), null);
    assert.equal(ftsQuery('F = ma 2'), '"ma" OR "2"');
  });

  test('ocr: a normal text page stays text; thin, wordless or glyph-garbage pages need OCR', () => {
    assert.ok(!classifyPageText(prose.repeat(3)).needsOcr);
    const thin = classifyPageText('Figure 3');
    assert.ok(thin.needsOcr && thin.reasons.includes('too_little_text'));
    const symbols = classifyPageText('∫ ∂ ∑ ∆ 1 2 3 4 5 6 7 8 9 = + − × ÷ '.repeat(20));
    assert.ok(symbols.needsOcr && symbols.reasons.includes('few_words'));
    const garbage = classifyPageText(prose.repeat(2) + '�'.repeat(20));
    assert.ok(garbage.needsOcr && garbage.reasons.includes('garbage_glyphs'), JSON.stringify(garbage));
  });

  test('diff: unchanged by hash, edited passage is modified, deletions and additions are found', () => {
    const p = (id: string, text: string): DiffPassage => ({ id, text, hash: normaliseForHash(text) });
    const old = [p('o1', 'Energy is conserved in a closed system.'), p('o2', 'Heat flows from hot to cold bodies spontaneously.'), p('o3', 'This paragraph was deleted entirely from the notes.')];
    const neu = [p('n1', 'Energy is   conserved in a *closed* system.'), p('n2', 'Heat flows from hot to cold bodies, never the reverse, spontaneously.'), p('n4', 'A brand new paragraph about entropy production.')];
    const d = diffPassages(old, neu);
    assert.deepEqual(d.unchanged, [{ oldId: 'o1', newId: 'n1' }], 'whitespace/emphasis changes are not modifications');
    assert.equal(d.modified.length, 1);
    assert.equal(d.modified[0]?.oldId, 'o2');
    assert.equal(d.modified[0]?.newId, 'n2');
    assert.deepEqual(d.removed, ['o3']);
    assert.deepEqual(d.added, ['n4']);
  });

  test('diff: moved passages still match, and duplicates pair one-to-one', () => {
    const p = (id: string, text: string): DiffPassage => ({ id, text, hash: normaliseForHash(text) });
    const d = diffPassages([p('a', 'same text'), p('b', 'same text'), p('c', 'other')], [p('x', 'other'), p('y', 'same text')]);
    assert.equal(d.unchanged.length, 2);
    assert.deepEqual(d.removed, ['b']);
  });

  test('budget: due reviews first, new cards fill the rest up to the cap', () => {
    const plan = planDailyBudget({ dailyMinutes: 20, dueReviews: 30, newAvailable: 100 });
    // 30 × 10 s = 300 s; 1200 − 300 = 900 s; 900 / 40 = 22 new
    assert.equal(plan.newToday, 22);
    assert.equal(plan.estimatedMinutes, 20);
    assert.ok(!plan.backlog);
    assert.equal(planDailyBudget({ dailyMinutes: 600, dueReviews: 0, newAvailable: 999 }).newToday, MAX_NEW_PER_DAY);
    assert.equal(planDailyBudget({ dailyMinutes: 20, dueReviews: 0, newAvailable: 3 }).newToday, 3);
  });

  test('budget: a backlog bigger than the budget means no new cards', () => {
    const plan = planDailyBudget({ dailyMinutes: 5, dueReviews: 100, newAvailable: 50 });
    assert.ok(plan.backlog);
    assert.equal(plan.newToday, 0);
  });

  test('budget: uses the median of Alex\'s own recent timings', () => {
    const plan = planDailyBudget({ dailyMinutes: 10, dueReviews: 10, newAvailable: 50, recentReviewMs: [6000, 6000, 600000], recentNewCardMs: [30000] });
    assert.equal(plan.secondsPerReview, 6, 'median ignores the one outlier');
    assert.equal(plan.newToday, 18); // 600 − 60 = 540 s / 30 s
    assert.equal(median([]), null);
    assert.equal(median([1, 3]), 2);
  });
}
