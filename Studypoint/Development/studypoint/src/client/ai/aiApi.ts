// Calls to the Worker's AI routes (step 5). The text sent here is the decrypted material ONE request needs;
// the Worker passes it to Workers AI and stores nothing.

import { api } from '../api.ts';
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

export const generateCards = (passages: SentPassage[], topic: string, count: number, types: string[]) =>
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
