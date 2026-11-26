// AI_SYSTEM §5.2 streaming parser: chunk boundaries, markers, general blocks, coverage, LaTeX.

import { createSegmentParser, sentenceEnd, type ParseEvent, type SentenceEvent } from '../../src/shared/segments.ts';

type TestFn = (name: string, fn: () => void | Promise<void>) => void;
type Assert = { ok(c: unknown, m?: string): void; equal(a: unknown, b: unknown, m?: string): void; deepEqual(a: unknown, b: unknown, m?: string): void };

const ANSWER =
  '<coverage>covered</coverage>' +
  'Entropy measures how spread out energy is. ⟦P1: "entropy is a measure of energy dispersal"⟧ ' +
  'For a reversible process, $dS = \\delta Q / T$ holds exactly. ⟦P2: "dS equals delta Q over T for reversible processes"⟧ ' +
  '<general>Many textbooks also describe entropy as disorder.</general> ' +
  'The value 3.5 J/K comes from the worked example. ⟦P2: "the result is 3.5 J/K"⟧\n\n' +
  'Sources disagree on the sign convention. <conflict/> ⟦P1: "work done on the system is positive"⟧ ⟦P3: "work done by the system is positive"⟧ ' +
  'This sentence has no citation.';

function run(chunks: string[]): ParseEvent[] {
  const p = createSegmentParser();
  const out: ParseEvent[] = [];
  for (const c of chunks) out.push(...p.push(c));
  out.push(...p.end());
  return out;
}

const sentences = (evs: ParseEvent[]) => evs.filter((e): e is SentenceEvent => e.type === 'sentence');

export function register(test: TestFn, assert: Assert): void {
  test('segments: whole answer parses into coverage + typed sentences', () => {
    const evs = run([ANSWER]);
    assert.deepEqual(evs[0], { type: 'coverage', value: 'covered' });
    const s = sentences(evs);
    assert.equal(s.length, 6, JSON.stringify(s.map((x) => x.text)));
    assert.equal(s[0]?.kind, 'cited');
    assert.deepEqual(s[0]?.citations, [{ ref: 'P1', quote: 'entropy is a measure of energy dispersal' }]);
    assert.equal(s[0]?.text, 'Entropy measures how spread out energy is.');
    assert.ok((s[1]?.text ?? '').includes('$dS = \\delta Q / T$'), 'LaTeX kept intact');
    assert.equal(s[2]?.kind, 'general');
    assert.equal(s[2]?.citations.length, 0);
    assert.ok((s[3]?.text ?? '').includes('3.5 J/K'), 'decimal point is not a sentence end');
    assert.ok(s[4]?.conflict && s[4]?.citations.length === 2, 'conflict flag with both citations');
    assert.equal(s[5]?.kind, 'uncited');
  });

  test('segments: identical result no matter how the stream is chunked', () => {
    const whole = JSON.stringify(run([ANSWER]));
    for (const size of [1, 2, 3, 5, 7, 11, 64]) {
      const chunks: string[] = [];
      for (let i = 0; i < ANSWER.length; i += size) chunks.push(ANSWER.slice(i, i + size));
      assert.equal(JSON.stringify(run(chunks)), whole, `chunk size ${size}`);
    }
  });

  test('segments: a sentence is held back until its marker has fully arrived', () => {
    const p = createSegmentParser();
    p.push('<coverage>partial</coverage>');
    assert.equal(sentences(p.push('Torque is force times lever arm. ⟦P4: "torque eq')).length, 0);
    const done = sentences(p.push('uals force times lever arm"⟧ Next'));
    assert.equal(done.length, 1);
    assert.equal(done[0]?.citations[0]?.quote, 'torque equals force times lever arm');
  });

  test('segments: not_found coverage is reported first', () => {
    const evs = run(['<cover', 'age>not_found</coverage>', 'Not found in your materials.']);
    assert.deepEqual(evs[0], { type: 'coverage', value: 'not_found' });
  });

  test('segments: sentenceEnd ignores dots in math and markers, waits at the buffer end', () => {
    assert.equal(sentenceEnd('Value $x = 1.5$ here. Next'), 21);
    assert.equal(sentenceEnd('Pi is 3.'), -1, 'might be "3.14"');
    assert.equal(sentenceEnd('Done. ⟦P1: "a. b"⟧ Next'), 18);
  });
}
