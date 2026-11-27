// CRD-01 card logic, CRD-07 exam cram, Word-style math splitting and web-page text extraction (all pure).

import { checkTypedAnswer, clozeNumbers, clozePieces, payloadProblem, variantsOf } from '../../src/shared/cards.ts';
import { capDueForExam, cramNewToday, cramStatus, interleave } from '../../src/shared/examCram.ts';
import { splitMath } from '../../src/shared/mathText.ts';
import { decodeEntities, eventsToMarkdown, type HtmlEvent } from '../../src/shared/htmlToMarkdown.ts';
import { parseMarkdown } from '../../src/shared/markdown.ts';

type TestFn = (name: string, fn: () => void | Promise<void>) => void;
type Assert = { ok(c: unknown, m?: string): void; equal(a: unknown, b: unknown, m?: string): void; deepEqual(a: unknown, b: unknown, m?: string): void };

const DAY = 86_400_000;

export function register(test: TestFn, assert: Assert): void {
  test('cards: variants per type (front/back + reverse, one per blank, one per mask)', () => {
    assert.deepEqual(variantsOf({ type: 'basic', front: 'a', back: 'b', reversible: true, answerMode: 'reveal' }), ['main', 'reverse']);
    assert.deepEqual(variantsOf({ type: 'basic', front: 'a', back: 'b', reversible: false, answerMode: 'typed' }), ['main']);
    assert.deepEqual(variantsOf({ type: 'cloze', text: '{{c2::b}} and {{c1::a}} then {{c2::c}}', extra: '' }), ['c1', 'c2']);
    assert.deepEqual(variantsOf({ type: 'occlusion', fileId: 'f', page: 1, caption: '', mode: 'hide-one', masks: [{ id: 'a1', x: 0, y: 0, w: 0.1, h: 0.1, label: 'Valve' }] }), ['m:a1']);
  });

  test('cloze: the active blank hides, others show; hints and math inside blanks survive', () => {
    const text = 'Fourier: {{c1::q = -k\\nabla T::heat flux}} where {{c2::k}} is conductivity';
    assert.deepEqual(clozeNumbers(text), [1, 2]);
    const p1 = clozePieces(text, 1);
    assert.deepEqual(p1[1], { kind: 'hidden', answer: 'q = -k\\nabla T', hint: 'heat flux', active: true });
    assert.deepEqual(p1[3], { kind: 'text', text: 'k' }, 'blank 2 shown as text on card 1');
    const p2 = clozePieces('\\frac{a}{b} is {{c1::\\frac{1}{2}}}', 1);
    assert.equal(p2[1]?.kind === 'hidden' ? p2[1].answer : '', '\\frac{1}{2}', 'braces inside a blank');
    assert.ok(payloadProblem({ type: 'cloze', text: 'no blanks here', extra: '' }) !== null);
  });

  test('typed answers: forgiving text, numbers within 1%, one typo on longer words', () => {
    assert.ok(checkTypedAnswer('  Conduction. ', 'conduction').correct);
    assert.ok(checkTypedAnswer('Résumé', 'resume').correct, 'accents');
    assert.ok(checkTypedAnswer('9.81', '9.8').correct, 'within 1%');
    assert.ok(!checkTypedAnswer('9.5', '9.8').correct);
    assert.ok(checkTypedAnswer('6.02e23', '6.022 × 10^23').correct, 'scientific notation');
    assert.ok(checkTypedAnswer('conducton', 'conduction').correct, 'one typo');
    assert.ok(!checkTypedAnswer('cat', 'car').correct, 'short words must be exact');
    assert.ok(!checkTypedAnswer('', 'x').correct);
  });

  test('exam cram: due dates are pulled in before the exam, never to "right now"', () => {
    const now = Date.UTC(2026, 11, 1);
    const exam = now + 10 * DAY;
    assert.equal(capDueForExam(now + 3 * DAY, exam, now), now + 3 * DAY, 'already before the exam');
    assert.equal(capDueForExam(now + 40 * DAY, exam, now), exam - DAY, 'capped to the day before');
    assert.equal(capDueForExam(now + 40 * DAY, null, now), now + 40 * DAY, 'no exam');
    assert.equal(capDueForExam(now + 5 * DAY, now + 5 * 60_000, now), now + 5 * DAY, 'exam passed the cap point: no change below now+gap');
    const st = cramStatus(exam, now, 300, 20);
    assert.equal(st.daysLeft, 10);
    assert.ok(!st.onTrack, '300 unseen > 10 days × 20');
    assert.equal(cramNewToday(300, 10, 20), 30, 'fair share beats the normal pace');
    assert.equal(cramNewToday(50, 10, 20), 20);
  });

  test('interleave: round-robin across courses so the same one doesn’t repeat when avoidable', () => {
    const items = ['a1', 'a2', 'a3', 'b1', 'c1', 'c2'];
    assert.deepEqual(interleave(items, (s) => s[0] as string), ['a1', 'b1', 'c1', 'a2', 'c2', 'a3']);
  });

  test('math text: backslash commands render as math, plain words stay text, no $ needed', () => {
    const s = splitMath('Flux is \\frac{dQ}{dt} and \\alpha decays');
    assert.deepEqual(s.map((x) => (x.math ? `M:${x.latex}` : `T:${x.text}`)), ['T:Flux is ', 'M:\\frac{dQ}{dt}', 'T: and ', 'M:\\alpha', 'T: decays']);
    assert.deepEqual(splitMath('price $5 and x^2'), [{ math: false, text: 'price $5 and x^2' }]);
    const run = splitMath('E = mc^{2} \\cdot \\gamma');
    assert.ok(run.some((x) => x.math && x.latex.includes('\\cdot') && x.latex.includes('\\gamma')), 'adjacent commands form one run');
  });

  test('web import: readable text only; nav/scripts dropped; main/article preferred; entities decoded', () => {
    const ev = (html: Array<[string, string?]>): HtmlEvent[] => html.map(([k, v]) => (k.startsWith('/') ? { kind: 'close', tag: k.slice(1) } : k === '#' ? { kind: 'text', text: v ?? '' } : { kind: 'open', tag: k }));
    const long = 'Heat moves from hot to cold by conduction, convection and radiation. '.repeat(8);
    const page = ev([
      ['title'], ['#', 'Heat transfer &amp; you'], ['/title'],
      ['nav'], ['#', 'Home | About'], ['/nav'],
      ['script'], ['#', 'alert(1)'], ['/script'],
      ['main'], ['h1'], ['#', 'Heat transfer'], ['/h1'], ['p'], ['#', long], ['/p'],
      ['ul'], ['li'], ['#', 'Conduction'], ['/li'], ['li'], ['strong'], ['#', 'Convection'], ['/strong'], ['/li'], ['/ul'], ['/main'],
      ['footer'], ['#', '© 2026'], ['/footer'],
    ]);
    const out = eventsToMarkdown(page);
    assert.equal(out.title, 'Heat transfer & you');
    assert.ok(out.markdown.startsWith('# Heat transfer'), out.markdown.slice(0, 40));
    assert.ok(out.markdown.includes('- Conduction\n- **Convection**'), 'list kept together');
    assert.ok(!out.markdown.includes('alert') && !out.markdown.includes('Home |') && !out.markdown.includes('©'), 'chrome dropped');
    assert.equal(decodeEntities('&lt;b&gt; &#x3B1; &#946; &deg;'), '<b> α β °');
  });

  test('markdown reader: headings, lists, quotes, code, links (http/https only) and emphasis', () => {
    const blocks = parseMarkdown('# Title\n\nSome **bold** and *it* and `code` and [link](https://x.org) and [bad](javascript:alert(1)).\n\n- one\n- two\n\n1. first\n\n> quote\n\n```\ncode block\n```\n\n---');
    assert.equal(blocks[0]?.type, 'heading');
    const para = blocks[1];
    assert.ok(para?.type === 'para');
    if (para?.type === 'para') {
      const kinds = para.inline.map((i) => i.kind);
      assert.ok(kinds.includes('bold') && kinds.includes('italic') && kinds.includes('code') && kinds.includes('link'));
      assert.ok(!para.inline.some((i) => i.kind === 'link' && i.href.startsWith('javascript')), 'unsafe link becomes text');
    }
    assert.deepEqual(blocks.slice(2).map((b) => b.type), ['list', 'list', 'quote', 'code', 'rule']);
  });
}
