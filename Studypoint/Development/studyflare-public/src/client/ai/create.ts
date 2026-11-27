// Making course materials with AI (step 5, CRD-03/04, QZ-03, LKP-04): pick the passages for a topic, ask
// the model, then CHECK everything before Alex sees it: each item's quote must be found word-for-word in
// the passage it cites, format rules must pass, and a second model must agree it's correct. Rejected
// items are kept with their reasons so Alex can see why.

import { checkCard, checkQuestion, type Checked, type GenCard, type PassageText, type QuizQuestion } from '../../shared/aiOutput.ts';
import type { CardPayload } from '../../shared/cards.ts';
import { generateArticle, generateCards, generateDiagram, generateQuiz, validateItems, type SentPassage } from './aiApi.ts';
import { searchCourse, type CourseIndex } from './indexer.ts';

export type TopicPassages = { sent: SentPassage[]; texts: PassageText[]; sourcesNote: string };

/** The best passages for a topic (optionally only from some sources), labelled P1…Pn. */
export async function passagesFor(index: CourseIndex, topic: string, sourceIds: readonly string[] = [], limit = 10): Promise<TopicPassages> {
  const restricted = sourceIds.length ? { ...index, passages: index.passages.filter((p) => sourceIds.includes(p.sourceId)) } : index;
  const pool = restricted.passages.length ? restricted : index;
  let hits = await searchCourse({ ...pool, kw: pool === index ? index.kw : (await import('../../shared/searchIndex.ts')).buildKeywordIndex(pool.passages) }, topic, limit);
  if (hits.length === 0) hits = pool.passages.slice(0, limit).map((passage) => ({ passage, score: 0 }));
  const sent = hits.map((h, i) => ({ ref: `P${i + 1}`, label: `${index.titles.get(h.passage.sourceId) ?? 'Source'}, ${h.passage.loc}`, text: h.passage.text, ocr: h.passage.ocr }));
  return {
    sent,
    texts: sent.map((s) => ({ ref: s.ref, text: s.text, ocr: Boolean(s.ocr) })),
    sourcesNote: sent.map((s) => `- [${s.ref}] ${s.label}`).join('\n'),
  };
}

/** A compact outline of the course for planning: each source's title, its sections, and how it starts. */
export function courseOutline(index: CourseIndex, maxChars = 50_000): { outline: string; ids: Map<string, string> } {
  const bySource = new Map<string, typeof index.passages>();
  for (const p of index.passages) {
    const list = bySource.get(p.sourceId);
    if (list) list.push(p);
    else bySource.set(p.sourceId, [p]);
  }
  const ids = new Map<string, string>();
  const parts: string[] = [];
  let n = 0;
  for (const [sourceId, ps] of bySource) {
    n += 1;
    const sid = `S${n}`;
    ids.set(sid, sourceId);
    const locs = [...new Set(ps.map((p) => p.loc))].slice(0, 40).join('; ');
    const start = ps.slice(0, 3).map((p) => p.text.slice(0, 400)).join(' … ');
    parts.push(`[${sid}] ${index.titles.get(sourceId) ?? 'Source'}\nSections: ${locs}\nStarts: ${start}`);
  }
  let outline = parts.join('\n\n');
  if (outline.length > maxChars) outline = outline.slice(0, maxChars);
  return { outline, ids };
}

export type ReviewedCards = { accepted: Array<{ card: GenCard; payload: CardPayload }>; rejected: Array<{ card: GenCard; reasons: string[] }> };

function toPayload(c: GenCard): CardPayload {
  if (c.kind === 'cloze') return { type: 'cloze', text: c.text, extra: c.extra };
  return { type: 'basic', front: c.front, back: c.back, reversible: false, answerMode: c.kind === 'typed' ? 'typed' : 'reveal' };
}

/** Generate → mechanical checks → second-model validation. */
async function reviewed<T>(items: T[], check: (i: T) => Checked<T>, kind: 'cards' | 'quiz', tp: TopicPassages) {
  const mech = items.map(check);
  const passed = mech.filter((m) => m.ok);
  let verdicts: Array<{ index: number; ok: boolean; reason: string }> = [];
  if (passed.length) {
    try {
      verdicts = (await validateItems(kind, passed.map((m) => m.item), tp.sent)).verdicts;
    } catch {
      verdicts = passed.map((_, index) => ({ index, ok: false, reason: 'the checker couldn’t be reached, so it wasn’t verified' }));
    }
  }
  const accepted: T[] = [];
  const rejected: Array<{ item: T; reasons: string[] }> = mech.filter((m) => !m.ok).map((m) => ({ item: m.item, reasons: m.reasons }));
  passed.forEach((m, i) => {
    const v = verdicts.find((x) => x.index === i);
    if (v?.ok) accepted.push(m.item);
    else rejected.push({ item: m.item, reasons: [v ? `checker: ${v.reason || 'not correct'}` : 'the checker gave no verdict'] });
  });
  return { accepted, rejected };
}

export async function makeCards(tp: TopicPassages, topic: string, count: number, types: string[]): Promise<ReviewedCards> {
  const { items } = await generateCards(tp.sent, topic, count, types);
  const r = await reviewed(items, (c) => checkCard(c, tp.texts), 'cards', tp);
  return { accepted: r.accepted.map((card) => ({ card, payload: toPayload(card) })), rejected: r.rejected.map((x) => ({ card: x.item, reasons: x.reasons })) };
}

export async function makeQuiz(tp: TopicPassages, topic: string, count: number, formats: string[], difficulty: number) {
  const { items } = await generateQuiz(tp.sent, topic, count, formats, difficulty);
  return reviewed<QuizQuestion>(items, (q) => checkQuestion(q, tp.texts), 'quiz', tp);
}

/** A study guide as Markdown, with its sources listed at the end and an AI label at the top. */
export async function makeArticle(tp: TopicPassages, topic: string, length: 'short' | 'medium'): Promise<{ title: string; markdown: string }> {
  const { article } = await generateArticle(tp.sent, topic, length);
  const title = article.title || topic;
  const markdown = `# ${title}\n\n> Made by Studyflare’s AI from your own material. Check anything important against the sources listed at the end.\n\n${article.markdown.replace(/^#\s.*\n/, '')}\n\n## Sources\n\n${tp.sourcesNote}\n`;
  return { title, markdown };
}

export async function makeDiagram(tp: TopicPassages, topic: string): Promise<{ title: string; markdown: string }> {
  const { diagram } = await generateDiagram(tp.sent, topic);
  if (!diagram.mermaid) throw new Error('The AI didn’t return a diagram. Try a more specific topic.');
  const title = diagram.title || topic;
  const markdown = `# ${title}\n\n> A diagram made by Studyflare’s AI from your own material.\n\n\`\`\`mermaid\n${diagram.mermaid}\n\`\`\`\n\n${diagram.caption}\n\n## Sources\n\n${tp.sourcesNote}\n`;
  return { title, markdown };
}
