// Parsing and mechanically checking what the AI returns (AI_SYSTEM §6, AGENTS 4/5). Pure and shared: the
// Worker uses it to turn model text into clean data, the browser uses it again for the checks that need
// the passages (which only the browser can read). Anything malformed is dropped with a reason, never
// "fixed up" into something the model didn't say.

import { verifyQuote } from './citations.ts';
import { clozeNumbers } from './cards.ts';

/** The first JSON object or array in a model reply (models sometimes wrap JSON in prose or ``` fences). */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fenced?.[1] ?? text;
  const start = body.search(/[{[]/);
  if (start < 0) throw new Error('No JSON in the reply.');
  const open = body[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  for (let i = start; i < body.length; i += 1) {
    const ch = body[i];
    if (inStr) {
      if (ch === '\\') i += 1;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return JSON.parse(body.slice(start, i + 1));
    }
  }
  throw new Error('The JSON in the reply was cut off.');
}

const str = (v: unknown, max = 4000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Every generated item cites one passage ("P3") and a verbatim quote from it. */
export type Grounding = { ref: string; quote: string };

export type GenCard =
  | ({ kind: 'basic'; front: string; back: string } & Grounding)
  | ({ kind: 'typed'; front: string; back: string } & Grounding)
  | ({ kind: 'cloze'; text: string; extra: string } & Grounding);

export type QuizQuestion = Grounding & { explanation: string; difficulty: 1 | 2 | 3 | 4 | 5 } & (
  | { format: 'mcq'; stem: string; options: string[]; correct: number }
  | { format: 'tf'; stem: string; answer: boolean }
  | { format: 'numeric'; stem: string; value: number; tolerance: number; units: string }
  | { format: 'short'; stem: string; answer: string; rubric: string[] }
);

export type PlanTopic = { title: string; summary: string; sourceIds: string[]; make: Array<'article' | 'diagram' | 'cards' | 'quiz'> };
export type Article = { title: string; markdown: string; sources: string[] };
export type Diagram = { title: string; mermaid: string; caption: string; sources: string[] };
export type Verdict = { index: number; ok: boolean; reason: string };
export type Grade = { score: number; feedback: string };

const ground = (o: Record<string, unknown>): Grounding => ({ ref: str(o['ref'] ?? o['source'], 12).toUpperCase(), quote: str(o['quote'], 600) });

export function parseCards(raw: unknown): GenCard[] {
  const out: GenCard[] = [];
  for (const item of arr(obj(raw)['cards'] ?? raw)) {
    const o = obj(item);
    const kind = str(o['type'] ?? o['kind'], 20).toLowerCase();
    if (kind === 'cloze') out.push({ kind: 'cloze', text: str(o['text']), extra: str(o['extra']), ...ground(o) });
    else if (kind === 'typed') out.push({ kind: 'typed', front: str(o['front']), back: str(o['back'], 300), ...ground(o) });
    else if (kind === 'basic' || kind === '') out.push({ kind: 'basic', front: str(o['front']), back: str(o['back']), ...ground(o) });
  }
  return out;
}

export function parseQuiz(raw: unknown): QuizQuestion[] {
  const out: QuizQuestion[] = [];
  for (const item of arr(obj(raw)['questions'] ?? raw)) {
    const o = obj(item);
    const base = { ...ground(o), explanation: str(o['explanation'], 1500), difficulty: Math.min(5, Math.max(1, Math.round(Number(o['difficulty']) || 3))) as 1 | 2 | 3 | 4 | 5 };
    const stem = str(o['stem'] ?? o['question']);
    const format = str(o['format'] ?? o['type'], 20).toLowerCase();
    if (format === 'mcq') {
      const options = arr(o['options']).map((x) => str(x, 400));
      out.push({ ...base, format: 'mcq', stem, options, correct: Number(o['correct']) });
    } else if (format === 'tf' || format === 'true_false') {
      out.push({ ...base, format: 'tf', stem, answer: o['answer'] === true || o['answer'] === 'true' });
    } else if (format === 'numeric') {
      out.push({ ...base, format: 'numeric', stem, value: Number(o['value'] ?? o['answer']), tolerance: Math.abs(Number(o['tolerance'])), units: str(o['units'], 40) });
    } else if (format === 'short') {
      out.push({ ...base, format: 'short', stem, answer: str(o['answer'], 1500), rubric: arr(o['rubric']).map((x) => str(x, 300)).filter(Boolean) });
    }
  }
  return out;
}

export function parsePlan(raw: unknown): PlanTopic[] {
  const kinds = ['article', 'diagram', 'cards', 'quiz'] as const;
  return arr(obj(raw)['topics'] ?? raw).map((t) => {
    const o = obj(t);
    return {
      title: str(o['title'], 160),
      summary: str(o['summary'], 600),
      sourceIds: arr(o['sources'] ?? o['sourceIds']).map((x) => str(x, 60)).filter(Boolean),
      make: arr(o['make']).map((x) => str(x, 20).toLowerCase()).filter((x): x is PlanTopic['make'][number] => (kinds as readonly string[]).includes(x)),
    };
  }).filter((t) => t.title);
}

export function parseArticle(raw: unknown): Article {
  const o = obj(raw);
  return { title: str(o['title'], 160), markdown: str(o['markdown'] ?? o['body'], 60_000), sources: arr(o['sources']).map((x) => str(x, 12).toUpperCase()) };
}

export function parseDiagram(raw: unknown): Diagram {
  const o = obj(raw);
  const code = str(o['mermaid'] ?? o['code'], 8000).replace(/^```(?:mermaid)?\s*|```$/g, '').trim();
  return { title: str(o['title'], 160), mermaid: code, caption: str(o['caption'], 600), sources: arr(o['sources']).map((x) => str(x, 12).toUpperCase()) };
}

export function parseVerdicts(raw: unknown): Verdict[] {
  return arr(obj(raw)['verdicts'] ?? raw).map((v) => {
    const o = obj(v);
    return { index: Number(o['index']), ok: o['ok'] === true || o['verdict'] === 'ok', reason: str(o['reason'], 300) };
  }).filter((v) => Number.isInteger(v.index));
}

export function parseGrade(raw: unknown): Grade {
  const o = obj(raw);
  const s = Number(o['score']);
  return { score: Number.isFinite(s) ? Math.min(1, Math.max(0, s)) : 0, feedback: str(o['feedback'], 1200) };
}

// ---------------------------------------------------------------- mechanical checks --

export type PassageText = { ref: string; text: string; ocr: boolean };
export type Checked<T> = { item: T; ok: boolean; reasons: string[] };

function quoteOk(g: Grounding, passages: readonly PassageText[]): string | null {
  const p = passages.find((x) => x.ref === g.ref);
  if (!p) return `cites ${g.ref || 'no passage'}, which wasn’t given`;
  if (!g.quote) return 'no supporting quote';
  return verifyQuote(g.quote, p.text, { ocr: p.ocr }).verified ? null : 'its quote isn’t in the cited passage';
}

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/** Format rules for cards (AI_SYSTEM §6.2) plus the quote check. */
export function checkCard(c: GenCard, passages: readonly PassageText[]): Checked<GenCard> {
  const reasons: string[] = [];
  const q = quoteOk(c, passages);
  if (q) reasons.push(q);
  if (c.kind === 'cloze') {
    const n = clozeNumbers(c.text).length;
    if (n < 1 || n > 3) reasons.push('a fill-in-the-blank card needs 1–3 blanks');
  } else {
    if (!c.front || !c.back) reasons.push('missing front or back');
    if (words(c.back) > 30) reasons.push('the answer is longer than about 25 words');
    if (c.back && c.front.toLowerCase().includes(c.back.toLowerCase()) && c.back.length > 3) reasons.push('the question gives away the answer');
  }
  return { item: c, ok: reasons.length === 0, reasons };
}

/** Format rules for quiz questions (AI_SYSTEM §6.2) plus the quote check. */
export function checkQuestion(q: QuizQuestion, passages: readonly PassageText[]): Checked<QuizQuestion> {
  const reasons: string[] = [];
  const g = quoteOk(q, passages);
  if (g) reasons.push(g);
  if (!q.stem) reasons.push('no question text');
  if (q.format === 'mcq') {
    const norm = q.options.map((o) => o.toLowerCase().replace(/\s+/g, ' ').trim());
    if (q.options.length !== 4) reasons.push('needs exactly 4 options');
    if (new Set(norm).size !== norm.length) reasons.push('two options are the same');
    if (!Number.isInteger(q.correct) || q.correct < 0 || q.correct >= q.options.length) reasons.push('no valid correct option');
    if (norm.some((o) => /\b(all|none) of the above\b/.test(o))) reasons.push('uses “all/none of the above”');
    const lens = q.options.map((o) => o.length || 1);
    if (Math.max(...lens) > 2.5 * Math.min(...lens) && Math.max(...lens) > 30) reasons.push('options differ a lot in length (gives the answer away)');
  } else if (q.format === 'numeric') {
    if (!Number.isFinite(q.value)) reasons.push('no numeric answer');
    if (!Number.isFinite(q.tolerance) || q.tolerance <= 0) reasons.push('needs a tolerance');
  } else if (q.format === 'short') {
    if (!q.answer) reasons.push('no model answer');
    if (q.rubric.length === 0) reasons.push('needs a marking rubric');
  }
  return { item: q, ok: reasons.length === 0, reasons };
}

// ---------------------------------------------------------------- grading --

/** Deterministic grading where possible (AI_SYSTEM §7.1). Short answers return null: they need the AI. */
export function gradeDeterministic(q: QuizQuestion, response: unknown): number | null {
  if (q.format === 'mcq') return response === q.correct ? 1 : 0;
  if (q.format === 'tf') return response === q.answer ? 1 : 0;
  if (q.format === 'numeric') {
    const v = typeof response === 'number' ? response : Number(String(response ?? '').replace(/[\s,]/g, ''));
    return Number.isFinite(v) && Math.abs(v - q.value) <= q.tolerance ? 1 : 0;
  }
  return null;
}
