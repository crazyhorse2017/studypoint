// AST-02 citation verifier table (TESTING §4.1). All passages here are synthetic.

import { FUZZY_THRESHOLD_TEXT, boundedLevenshtein, normaliseWithMap, verifyQuote } from '../../src/shared/citations.ts';

type TestFn = (name: string, fn: () => void | Promise<void>) => void;
type Assert = { ok(c: unknown, m?: string): void; equal(a: unknown, b: unknown, m?: string): void };

const PASSAGE =
  'The first law of thermodynamics states that energy cannot be created or destroyed,\n' +
  'only transferred or converted. For a closed system, $\\Delta U = Q - W$, where *Q* is heat added\n' +
  'and W is work done by the system. The integral \\frac {a} {b} appears in the derivation.';

export function register(test: TestFn, assert: Assert): void {
  test('citations: exact quote verifies with score 1 and maps to original offsets', () => {
    const quote = 'energy cannot be created or destroyed';
    const r = verifyQuote(quote, PASSAGE);
    assert.ok(r.verified && r.reason === 'exact' && r.score === 1);
    assert.equal(PASSAGE.slice(r.start ?? 0, r.end ?? 0), quote);
  });

  test('citations: whitespace, line breaks and curly quotes/dashes are normalised', () => {
    const r = verifyQuote('cannot be created or destroyed, only transferred or converted', PASSAGE);
    assert.ok(r.verified, 'line break inside the quote');
    const p = 'He said “energy is conserved in every closed system” today.';
    assert.ok(verifyQuote('said "energy is conserved in every closed system" today', p).verified, 'curly vs straight quotes');
    assert.ok(verifyQuote('the range was 3–10 units in total', 'the range was 3-10 units in total').verified, 'en dash vs hyphen');
  });

  test('citations: Markdown emphasis is ignored', () => {
    assert.ok(verifyQuote('where Q is heat added and W is work', PASSAGE).verified);
  });

  test('citations: LaTeX spacing is canonicalised', () => {
    const a = normaliseWithMap('\\frac {a} {b}').text;
    const b = normaliseWithMap('\\frac{a}{b}').text;
    assert.equal(a, b);
    assert.ok(verifyQuote('The integral \\frac{a}{b} appears in', PASSAGE).verified);
  });

  test('citations: quotes shorter than 4 tokens never verify', () => {
    const r = verifyQuote('energy cannot be', PASSAGE);
    assert.ok(!r.verified && r.reason === 'too_short');
    assert.equal(verifyQuote('', PASSAGE).reason, 'empty');
  });

  test('citations: a near-miss (one typo) passes the text threshold; a paraphrase fails', () => {
    const typo = verifyQuote('energy cannot be creatd or destroyed', PASSAGE);
    assert.ok(typo.verified && typo.reason === 'fuzzy' && typo.score >= FUZZY_THRESHOLD_TEXT, `typo score ${typo.score}`);
    const para = verifyQuote('energy is never made or lost in any process', PASSAGE);
    assert.ok(!para.verified, `paraphrase must fail (score ${para.score})`);
  });

  test('citations: OCR passages use the looser threshold', () => {
    // About 6 character errors in ~51 characters: similarity ~0.88, between the OCR (0.85) and text (0.92) thresholds.
    const ocr = 'Tbe flrst Iaw of tbermodynamlcs statcs that energy cannot be created.';
    const q = 'The first law of thermodynamics states that energy';
    assert.ok(!verifyQuote(q, ocr).verified, 'too noisy for normal text');
    assert.ok(verifyQuote(q, ocr, { ocr: true }).verified, 'accepted with the OCR threshold');
  });

  test('citations: a quote from a different passage is rejected', () => {
    const r = verifyQuote('Torque equals force times the lever arm length', PASSAGE);
    assert.ok(!r.verified && r.reason === 'not_found');
  });

  test('citations: a fabricated sentence stitched from real fragments is rejected', () => {
    const r = verifyQuote('energy cannot be converted or destroyed by work done', PASSAGE);
    assert.ok(!r.verified, `stitched fragments must not verify (score ${r.score})`);
  });

  test('citations: banded Levenshtein matches the full computation and exits early', () => {
    assert.equal(boundedLevenshtein('kitten', 'sitting', 5), 3);
    assert.equal(boundedLevenshtein('flaw', 'lawn', 5), 2);
    assert.equal(boundedLevenshtein('abc', 'abc', 0), 0);
    assert.equal(boundedLevenshtein('abcdef', 'uvwxyz', 2), 3, 'over the limit returns limit + 1');
  });

  test('citations: long passages stay fast (CPU budget on Workers)', () => {
    const big = Array.from({ length: 500 }, (_, i) => `word${i % 97} filler${i % 13}`).join(' ');
    const t0 = performance.now();
    for (let i = 0; i < 20; i += 1) verifyQuote('this quote is definitely not present in the passage at all', big);
    const ms = (performance.now() - t0) / 20;
    assert.ok(ms < 50, `verify took ${ms.toFixed(1)} ms per call`);
  });
}
