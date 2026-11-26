// INS-02 course codes and the passage chunker (AI_SYSTEM §3). Synthetic text only (LIB-12).

import { checkCourseCode, codeAppearsIn, learnFormat, parseCourseCode } from '../../src/shared/courseCode.ts';
import { chunkLocation, estimateTokens, splitBlocks } from '../../src/shared/chunker.ts';

type TestFn = (name: string, fn: () => void | Promise<void>) => void;
type Assert = { ok(c: unknown, m?: string): void; equal(a: unknown, b: unknown, m?: string): void; deepEqual(a: unknown, b: unknown, m?: string): void };

const para = (n: number, word = 'alpha') => Array.from({ length: n }, (_, i) => `${word}${i}`).join(' ') + '.';

export function register(test: TestFn, assert: Assert): void {
  test('codes: typed codes normalise to "SUBJ 123"', () => {
    assert.equal(parseCourseCode('chem101')?.normalised, 'CHEM 101');
    assert.equal(parseCourseCode('  Phys-121L ')?.normalised, 'PHYS 121L');
    assert.equal(parseCourseCode('ENGR  1010')?.normalised, 'ENGR 1010');
    assert.equal(parseCourseCode('BIO.200')?.normalised, 'BIO 200');
    assert.equal(parseCourseCode('A&S 100')?.subject, 'A&S');
    assert.equal(parseCourseCode('101'), null);
    assert.equal(parseCourseCode('Chemistry'), null);
    assert.equal(parseCourseCode('X 101'), null);
  });

  test('codes: format check warns (never blocks) on unfamiliar subjects or number lengths', () => {
    const fmt = learnFormat(['CHEM 101', 'CHEM 102', 'PHYS 121']);
    const ok = checkCourseCode('chem 205', fmt);
    assert.ok(ok.ok && ok.warning === null);
    const subj = checkCourseCode('CEHM 101', fmt);
    assert.ok(subj.ok && (subj.warning ?? '').includes('CEHM'));
    const len = checkCourseCode('PHYS 1210', fmt);
    assert.ok(len.ok && (len.warning ?? '').includes('3'));
    const bad = checkCourseCode('hello', fmt);
    assert.ok(!bad.ok);
  });

  test('codes: catalog check finds codes with flexible spacing, not inside other codes', () => {
    const code = parseCourseCode('CHEM 101');
    assert.ok(code !== null);
    if (!code) return;
    assert.ok(codeAppearsIn(code, 'Course: CHEM101 - General Chemistry'));
    assert.ok(codeAppearsIn(code, 'chem 101 general chemistry'));
    assert.ok(codeAppearsIn(code, 'CHEM\u2013101'));
    assert.ok(!codeAppearsIn(code, 'CHEM 1010 Advanced'), 'must not match a longer number');
    assert.ok(!codeAppearsIn(code, 'BIOCHEM 101'), 'must not match inside another subject');
  });

  test('chunker: short location becomes one chunk with exact offsets', () => {
    const text = 'First paragraph here.\n\nSecond paragraph here.';
    const chunks = chunkLocation(text);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0]?.text, text);
    assert.equal(text.slice(chunks[0]?.charStart, chunks[0]?.charEnd), chunks[0]?.text);
  });

  test('chunker: long text splits into chunks within the token limit, with overlap', () => {
    const text = Array.from({ length: 30 }, (_, i) => para(25, `w${i}x`)).join('\n\n');
    const chunks = chunkLocation(text);
    assert.ok(chunks.length >= 3, `expected several chunks, got ${chunks.length}`);
    for (const c of chunks) {
      assert.ok(c.tokenCount <= 450, `chunk ${c.ordinal} has ${c.tokenCount} tokens`);
      assert.equal(text.slice(c.charStart, c.charEnd), c.text);
    }
    for (let i = 1; i < chunks.length; i += 1) {
      assert.ok((chunks[i]?.charStart ?? 0) < (chunks[i - 1]?.charEnd ?? 0), `chunk ${i} should overlap the previous one`);
    }
    assert.equal(chunks[chunks.length - 1]?.charEnd, text.length, 'covers the whole text');
  });

  test('chunker: display math and tables are never split', () => {
    const math = '$$\n\\int_0^1 x^2 \\, dx = \\frac{1}{3}\n\n\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}\n$$';
    const table = '| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |';
    const text = [para(200, 'pre'), math, para(10, 'mid'), table, para(200, 'post')].join('\n\n');
    const chunks = chunkLocation(text);
    const holding = (s: string) => chunks.filter((c) => c.text.includes(s));
    assert.ok(holding(math).length >= 1, 'math block kept whole in some chunk');
    assert.ok(holding(table).length >= 1, 'table kept whole in some chunk');
    for (const c of chunks) {
      const opens = (c.text.match(/\$\$/g) ?? []).length;
      assert.equal(opens % 2, 0, `chunk ${c.ordinal} cuts a $$ block`);
    }
    const blocks = splitBlocks(text);
    assert.ok(blocks.some((b) => b.atomic && b.text === math));
    assert.ok(blocks.some((b) => b.atomic && b.text === table));
  });

  test('chunker: one enormous paragraph is cut by sentences, then words', () => {
    const giant = Array.from({ length: 1200 }, (_, i) => `tok${i}`).join(' ');
    const chunks = chunkLocation(giant);
    assert.ok(chunks.length >= 3);
    for (const c of chunks) assert.ok(c.tokenCount <= 450, `${c.tokenCount} tokens`);
  });

  test('chunker: token estimate is conservative', () => {
    assert.equal(estimateTokens(''), 0);
    assert.ok(estimateTokens('one two three') >= 3);
    assert.ok(estimateTokens('x'.repeat(400)) >= 100);
  });
}
