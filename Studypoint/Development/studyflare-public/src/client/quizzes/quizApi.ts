// Practice quizzes on the client (QZ-01..04). Questions and your answers are encrypted here; the Worker
// stores ciphertext plus scores.

import { api } from '../api.ts';
import { decryptText, encryptText } from '../../shared/crypto/vault.ts';
import type { QuizQuestion } from '../../shared/aiOutput.ts';
import { uuid7 } from '../../shared/uuid7.ts';
import { currentDataKey } from '../vault/vaultStore.ts';

export type QuizSummary = { id: string; courseId: string; title: string; count: number; score: number | null; submittedAt: number | null; createdAt: number };
export type QuizItem = { id: string; question: QuizQuestion | null };
export type Quiz = QuizSummary & { questions: QuizItem[] };

function key(): CryptoKey {
  const k = currentDataKey();
  if (!k) throw new Error('Studyflare is locked.');
  return k;
}

async function title(q: QuizSummary): Promise<QuizSummary> {
  try {
    return { ...q, title: await decryptText(key(), q.title, `${q.id}#title`) };
  } catch {
    return { ...q, title: 'Can’t be decrypted' };
  }
}

export async function fetchQuizzes(courseId: string): Promise<QuizSummary[]> {
  const { quizzes } = await api<{ quizzes: QuizSummary[] }>('GET', `/api/quizzes?course=${encodeURIComponent(courseId)}`);
  return Promise.all(quizzes.map(title));
}

export async function fetchQuiz(id: string): Promise<Quiz> {
  const { quiz } = await api<{ quiz: QuizSummary & { questions: Array<{ id: string; format: string; payload: string }> } }>('GET', `/api/quizzes/${encodeURIComponent(id)}`);
  const head = await title(quiz);
  const questions = await Promise.all(quiz.questions.map(async (q) => {
    try {
      return { id: q.id, question: JSON.parse(await decryptText(key(), q.payload, `${q.id}#q`)) as QuizQuestion };
    } catch {
      return { id: q.id, question: null };
    }
  }));
  return { ...head, questions };
}

export async function saveQuiz(courseId: string, name: string, questions: QuizQuestion[]): Promise<string> {
  const id = uuid7();
  const k = key();
  const qs = await Promise.all(questions.map(async (q) => {
    const qid = uuid7();
    return { id: qid, format: q.format, difficulty: q.difficulty, payload: await encryptText(k, JSON.stringify(q), `${qid}#q`) };
  }));
  await api('POST', '/api/quizzes', { id, courseId, title: await encryptText(k, name, `${id}#title`), questions: qs });
  return id;
}

export type Answered = { questionId: string; response: unknown; autoScore: number | null; aiScore: number | null; finalScore: number; durationMs: number };

export async function submitQuiz(quizId: string, answers: Answered[]): Promise<number> {
  const k = key();
  const items = await Promise.all(answers.map(async (a) => {
    const clientId = uuid7();
    return { ...a, clientId, response: await encryptText(k, JSON.stringify(a.response ?? null), `${clientId}#answer`) };
  }));
  return (await api<{ score: number }>('POST', `/api/quizzes/${encodeURIComponent(quizId)}/submit`, { items })).score;
}

export const hideQuiz = (id: string) => api('DELETE', `/api/quizzes/${encodeURIComponent(id)}`);
