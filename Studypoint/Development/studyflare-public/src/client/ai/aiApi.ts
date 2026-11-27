// Calls to the Worker's AI routes (step 5). The text sent here is the decrypted material ONE request needs;
// the Worker passes it to Workers AI and stores nothing.

import { ApiError, api } from '../api.ts';
import { parseAnswerStreamLine } from '../../shared/sseText.ts';
import type { Article, Diagram, GenCard, Grade, PlanTopic, QuizQuestion, Verdict } from '../../shared/aiOutput.ts';
/** A trusted web result (the Worker already checked it against the allowlist). */
export type WebResult = { url: string; title: string; content: string; score: number };

export type SentPassage = { ref: string; label: string; text: string; ocr?: boolean; url?: string };

export const aiStatus = () => api<{ ai: boolean; lookup: boolean; files: boolean }>('GET', '/api/ai/status');

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 32) {
    const r = await api<{ vectors: number[][] }>('POST', '/api/ai/embed', { texts: texts.slice(i, i + 32) });
    out.push(...r.vectors);
  }
  return out;
}

export async function ocrImage(dataUrl: string): Promise<string> {
  return (await api<{ text: string }>('POST', '/api/ai/ocr', { image: dataUrl })).text;
}

export async function askModel(question: string, passages: SentPassage[], mode: 'direct' | 'tutor', general: boolean): Promise<string> {
  return (await api<{ text: string }>('POST', '/api/ai/answer', { question, passages, mode, general })).text;
}

/**
 * The answer streamed (step 6a): `onText` gets each piece of the reply as it arrives. Resolves with the
 * whole reply. A failure partway through rejects with the AI's plain-language message.
 */
export async function askModelStream(question: string, passages: SentPassage[], mode: 'direct' | 'tutor', general: boolean, onText: (chunk: string) => void, signal?: AbortSignal): Promise<string> {
  let res: Response;
  try {
    res = await fetch('/api/ai/answer/stream', {
      method: 'POST',
      headers: { Accept: 'application/x-ndjson', 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, passages, mode, general }),
      signal,
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new ApiError(0, 'offline', "Studyflare can't be reached. Check your connection and try again.");
  }
  if (!res.ok || !res.body) {
    let msg = 'Something went wrong. Try again.';
    try {
      msg = ((await res.json()) as { error?: { message?: string } }).error?.message ?? msg;
    } catch {
      // not JSON
    }
    throw new ApiError(res.status, 'ai_error', msg);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let whole = '';
  const handle = (line: string) => {
    const ev = parseAnswerStreamLine(line);
    if (!ev) return;
    if ('error' in ev) throw new ApiError(502, 'ai_error', ev.error);
    if ('t' in ev) {
      whole += ev.t;
      onText(ev.t);
    }
  };
  for (;;) {
    const r = await reader.read();
    if (r.done) break;
    buf += decoder.decode(r.value, { stream: true });
    let nl = buf.indexOf('\n');
    while (nl >= 0) {
      handle(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
      nl = buf.indexOf('\n');
    }
  }
  handle(buf + decoder.decode());
  return whole;
}

export const generateCards =(passages: SentPassage[], topic: string, count: number, types: string[]) =>
  api<{ items: GenCard[] }>('POST', '/api/ai/generate', { kind: 'cards', passages, topic, count, types });
export const generateQuiz = (passages: SentPassage[], topic: string, count: number, formats: string[], difficulty: number) =>
  api<{ items: QuizQuestion[] }>('POST', '/api/ai/generate', { kind: 'quiz', passages, topic, count, formats, difficulty });
export const generateArticle = (passages: SentPassage[], topic: string, length: 'short' | 'medium') =>
  api<{ article: Article }>('POST', '/api/ai/generate', { kind: 'article', passages, topic, length });
export const generateDiagram = (passages: SentPassage[], topic: string) => api<{ diagram: Diagram }>('POST', '/api/ai/generate', { kind: 'diagram', passages, topic });
export const generatePlan = (outline: string, courseName: string) => api<{ topics: PlanTopic[] }>('POST', '/api/ai/generate', { kind: 'plan', outline, courseName });
export const validateItems = (kind: 'cards' | 'quiz', items: unknown[], passages: SentPassage[]) => api<{ verdicts: Verdict[] }>('POST', '/api/ai/validate', { kind, items, passages });
export const gradeShort = (stem: string, answer: string, rubric: string[], response: string) => api<Grade>('POST', '/api/ai/grade', { stem, answer, rubric, response });
export const webLookup = (query: string) => api<{ results: WebResult[] }>('POST', '/api/lookup', { query });
