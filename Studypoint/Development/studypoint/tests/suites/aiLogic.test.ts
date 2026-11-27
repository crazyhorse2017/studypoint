// Step 5 pure logic: AI output parsing and mechanical checks, trusted domains, in-browser search.

import { checkCard, checkQuestion, extractJson, gradeDeterministic, parseCards, parsePlan, parseQuiz, type QuizQuestion } from '../../src/shared/aiOutput.ts';
import { isTrustedUrl, searchDomains } from '../../src/shared/trustedDomains.ts';
import { verifyAnswer } from '../../src/shared/answer.ts';
import { bm25, buildKeywordIndex, cosine, hybridSearch, packVectors, unpackVectors, type IndexedPassage } from '../../src/shared/searchIndex.ts';

type TestFn = (name: string, fn: () => void | Promise<void>) => void;
type Assert = { ok(c: unknown, m?: string): void; equal(a: unknown, b: unknown, m?: string): void; deepEqual(a: unknown, b: unknown, m?: string): void };

const P1 = 'Heat conduction through a plane wall follows Fourier’s law, where the heat flux is proportional to the temperature gradient.';
const P2 = 'Convection transfers heat between a surface and a moving fluid; Newton’s law of cooling gives q = hA(Ts - T∞).';
const passages = [{ ref: 'P1', text: P1, ocr: false }, { ref: 'P2', text: P2, ocr: false }];

export function register(test: TestFn, assert: Assert): void {
  test('ai output: JSON is found inside prose and ``` fences; cut-off JSON is an error, not a guess', () => {
    assert.deepEqual(extractJson('Sure! ```json\n{"a":[1,{"b":"}"}]}\n``` done'), { a: [1, { b: '}' }] });
    assert.deepEqual(extractJson('{"x":"say \\"hi\\""} trailing'), { x: 'say "hi"' });
    let threw = false;
    try { extractJson('{"cards":[{"front":"a"'); } catch { threw = true; }
    assert.ok(threw);
  });

  test('ai cards: parsed, and each is checked: quote in the cited passage, format rules', () => {
    const cards = parseCards({ cards: [
      { type: 'basic', front: 'What does Fourier’s law relate?', back: 'Heat flux and temperature gradient', ref: 'p1', quote: 'the heat flux is proportional to the temperature gradient' },
      { type: 'basic', front: 'Newton’s law of cooling?', back: 'q = hA(Ts - T∞)', ref: 'P2', quote: 'a quote that is not in the passage at all' },
      { type: 'cloze', text: 'Convection moves heat between a surface and a {{c1::moving fluid}}.', ref: 'P2', quote: 'transfers heat between a surface and a moving fluid' },
      { type: 'cloze', text: 'no blanks here', ref: 'P2', quote: 'transfers heat between a surface and a moving fluid' },
      { type: 'basic', front: 'Q', back: 'x', ref: 'P9', quote: 'anything at all goes here' },
    ] });
    const results = cards.map((c) => checkCard(c, passages));
    assert.deepEqual(results.map((r) => r.ok), [true, false, true, false, false]);
    assert.ok(results[1]?.reasons.some((r) => r.includes('quote')));
    assert.ok(results[4]?.reasons.some((r) => r.includes('wasn’t given')));
  });

  test('ai quiz: MCQ rules (4 distinct options, one valid answer, no "all of the above"), numeric needs a tolerance', () => {
    const qs = parseQuiz({ questions: [
      { format: 'mcq', stem: 'Fourier’s law relates heat flux to…', options: ['the temperature gradient', 'the pressure drop', 'the fluid velocity', 'the wall color'], correct: 0, ref: 'P1', quote: 'the heat flux is proportional to the temperature gradient', explanation: 'x' },
      { format: 'mcq', stem: 'Pick one', options: ['a', 'a', 'b', 'all of the above'], correct: 7, ref: 'P1', quote: 'the heat flux is proportional to the temperature gradient' },
      { format: 'numeric', stem: 'h?', value: 25, tolerance: 0, ref: 'P2', quote: 'Newton’s law of cooling gives q = hA(Ts - T∞)' },
      { format: 'tf', stem: 'Convection needs a moving fluid.', answer: 'true', ref: 'P2', quote: 'transfers heat between a surface and a moving fluid' },
    ] });
    const ok = qs.map((q) => checkQuestion(q, passages));
    assert.deepEqual(ok.map((r) => r.ok), [true, false, false, true]);
    assert.ok(ok[1]?.reasons.length && ok[1].reasons.length >= 3, ok[1]?.reasons.join('; '));
    assert.equal(gradeDeterministic(qs[0] as QuizQuestion, 0), 1);
    assert.equal(gradeDeterministic(qs[3] as QuizQuestion, false), 0);
    const numeric: QuizQuestion = { format: 'numeric', stem: 'g', value: 9.81, tolerance: 0.05, units: 'm/s^2', ref: 'P1', quote: '', explanation: '', difficulty: 2 };
    assert.equal(gradeDeterministic(numeric, '9.8'), 1);
    assert.equal(gradeDeterministic(numeric, '10'), 0);
    assert.equal(gradeDeterministic({ format: 'short', stem: 's', answer: 'a', rubric: ['x'], ref: 'P1', quote: '', explanation: '', difficulty: 2 }, 'anything'), null, 'short answers need the AI');
  });

  test('ai plan: topics keep only known material kinds', () => {
    const plan = parsePlan({ topics: [{ title: 'Conduction', summary: 's', sources: ['S1'], make: ['article', 'cards', 'video'] }, { title: '' }] });
    assert.equal(plan.length, 1);
    assert.deepEqual(plan[0]?.make, ['article', 'cards']);
  });

  test('trusted domains: allowlist + .edu/.gov, blocklist always wins, final URL checked', () => {
    assert.ok(isTrustedUrl('https://openstax.org/books/university-physics-volume-2/pages/1-6-mechanisms-of-heat-transfer'));
    assert.ok(isTrustedUrl('https://www.engr.umbc.edu/~someone/notes.pdf'));
    assert.ok(isTrustedUrl('https://www.nist.gov/pml'));
    assert.ok(!isTrustedUrl('https://en.wikipedia.org/wiki/Heat_transfer'), 'Wikipedia is blocked');
    assert.ok(!isTrustedUrl('https://www.chegg.com/homework-help/x'));
    assert.ok(!isTrustedUrl('https://example.com/edu'), 'path tricks don’t count');
    assert.ok(!isTrustedUrl('https://openstax.org.evil.com/x'), 'look-alike hosts don’t count');
    assert.ok(!isTrustedUrl('javascript:alert(1)'));
    assert.ok(searchDomains().length <= 300);
  });

  test('answers: verified quotes become citations; failed quotes make a sentence "unverified"; general is labelled', () => {
    const raw = '<coverage>covered</coverage>Conduction follows Fourier’s law. ⟦P1: "heat flux is proportional to the temperature gradient"⟧ Convection is magic. ⟦P2: "convection is powered by magic dust"⟧ <general>Heat always flows from hot to cold.</general>';
    const a = verifyAnswer(raw, passages);
    assert.equal(a.coverage, 'covered');
    assert.deepEqual(a.segments.map((s) => s.kind), ['sourced', 'unverified', 'general']);
    assert.equal(a.verifiedCount, 1);
    assert.equal(a.failedCount, 1);
    assert.equal(verifyAnswer('<coverage>not_found</coverage>Not found in your materials.', passages).coverage, 'not_found');
  });

  test('search: BM25 finds keyword matches; vectors survive int8 packing; hybrid fuses both', () => {
    const ps: IndexedPassage[] = [
      { id: 's:0', sourceId: 's', loc: 'p. 1', page: 1, text: P1, ocr: false },
      { id: 's:1', sourceId: 's', loc: 'p. 2', page: 2, text: P2, ocr: false },
      { id: 's:2', sourceId: 's', loc: 'p. 3', page: 3, text: 'Radiation needs no medium and follows the Stefan–Boltzmann law.', ocr: false },
    ];
    const kw = buildKeywordIndex(ps);
    assert.equal(bm25(kw, 'Newton cooling convection')[0], 's:1');
    const vecs = [[1, 0, 0, 0.2], [0, 1, 0, 0.1], [0, 0, 1, 0]];
    const packed = packVectors(vecs);
    const back = unpackVectors(packed);
    assert.ok(cosine(back[0] as Float32Array, [1, 0, 0, 0.2]) > 0.999, 'quantisation keeps direction');
    const map = new Map(ps.map((p, i) => [p.id, back[i] as Float32Array]));
    const hits = hybridSearch(ps, map, kw, 'stefan boltzmann', [0, 0, 1, 0], 2);
    assert.equal(hits[0]?.passage.id, 's:2');
    const noVec = hybridSearch(ps, map, kw, 'temperature gradient', null, 1);
    assert.equal(noVec[0]?.passage.id, 's:0', 'works without vectors');
  });
}
