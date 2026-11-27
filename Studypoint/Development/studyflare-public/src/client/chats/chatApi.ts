// Saved conversations on the client (step 6a, AST-06). Titles and messages are encrypted here; the Worker
// stores ciphertext. An answer is saved with the passages it was verified against, so its citations still
// open (and pop up) later, even after a source changes.

import { api } from '../api.ts';
import { decryptText, encryptText } from '../../shared/crypto/vault.ts';
import type { VerifiedAnswer } from '../../shared/answer.ts';
import { uuid7 } from '../../shared/uuid7.ts';
import { currentDataKey } from '../vault/vaultStore.ts';

/** A passage an answer was checked against. `href` opens it (a Reader link, or a web page if `external`). */
export type ChatSource = { ref: string; title: string; loc: string; href: string; external: boolean; text: string; ocr: boolean };
export type ChatTurn = { id: string; question: string; answer: VerifiedAnswer; sources: ChatSource[]; web: boolean; at: number };
export type ChatMode = 'direct' | 'tutor';

export type ChatSummary = { id: string; courseId: string | null; title: string; mode: ChatMode; messages: number; createdAt: number; updatedAt: number };
export type Chat = ChatSummary & { turns: ChatTurn[] };

type RawSummary = Omit<ChatSummary, 'mode'> & { mode: string };
type RawMessage = { id: string; role: 'user' | 'assistant'; content: string; coverage: string | null; createdAt: number };

function key(): CryptoKey {
  const k = currentDataKey();
  if (!k) throw new Error('Studyflare is locked.');
  return k;
}

const UNREADABLE = 'Can’t be decrypted';

async function summary(c: RawSummary): Promise<ChatSummary> {
  let title = UNREADABLE;
  try {
    title = await decryptText(key(), c.title, `${c.id}#title`);
  } catch {
    // keep the placeholder
  }
  return { ...c, title, mode: c.mode === 'tutor' ? 'tutor' : 'direct' };
}

/** A short title from the first question. */
export function chatTitle(question: string): string {
  const q = question.replace(/\s+/g, ' ').trim();
  return q.length <= 80 ? q : `${q.slice(0, 77).trimEnd()}…`;
}

export async function fetchChats(courseId?: string): Promise<ChatSummary[]> {
  const q = courseId ? `?course=${encodeURIComponent(courseId)}` : '';
  const { conversations } = await api<{ conversations: RawSummary[] }>('GET', `/api/conversations${q}`);
  return Promise.all(conversations.map(summary));
}

/** Pair each question with the answer after it. A question with no saved answer is dropped. */
export function pairTurns(messages: ReadonlyArray<{ id: string; role: 'user' | 'assistant'; text: string | null; at: number }>): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (let i = 0; i < messages.length; i += 1) {
    const m = messages[i];
    const next = messages[i + 1];
    if (!m || m.role !== 'user' || !next || next.role !== 'assistant') continue;
    i += 1;
    let body: { answer?: VerifiedAnswer; sources?: ChatSource[]; web?: boolean } = {};
    try {
      body = next.text ? (JSON.parse(next.text) as typeof body) : {};
    } catch {
      body = {};
    }
    const answer: VerifiedAnswer = body.answer ?? { coverage: 'partial', segments: [{ kind: 'unverified', text: UNREADABLE, citations: [], conflict: false, uncertain: false }], verifiedCount: 0, failedCount: 0 };
    turns.push({ id: next.id, question: m.text ?? UNREADABLE, answer, sources: Array.isArray(body.sources) ? body.sources : [], web: body.web === true, at: next.at });
  }
  return turns;
}

export async function fetchChat(id: string): Promise<Chat> {
  const { conversation } = await api<{ conversation: RawSummary & { messageList: RawMessage[] } }>('GET', `/api/conversations/${encodeURIComponent(id)}`);
  const head = await summary(conversation);
  const k = key();
  const messages = await Promise.all(conversation.messageList.map(async (m) => {
    let text: string | null = null;
    try {
      text = await decryptText(k, m.content, `${m.id}#msg`);
    } catch {
      text = null;
    }
    return { id: m.id, role: m.role, text, at: m.createdAt };
  }));
  return { ...head, turns: pairTurns(messages) };
}

export async function startChat(courseId: string | null, firstQuestion: string, mode: ChatMode): Promise<ChatSummary> {
  const id = uuid7();
  const title = chatTitle(firstQuestion);
  await api('POST', '/api/conversations', { id, courseId, mode, title: await encryptText(key(), title, `${id}#title`) });
  const now = Date.now();
  return { id, courseId, title, mode, messages: 0, createdAt: now, updatedAt: now };
}

/** Save one question and its verified answer. */
export async function saveTurn(chatId: string, turn: Omit<ChatTurn, 'id' | 'at'>): Promise<void> {
  const k = key();
  const qid = uuid7();
  const aid = uuid7();
  await api('POST', `/api/conversations/${encodeURIComponent(chatId)}/messages`, {
    messages: [
      { id: qid, role: 'user', content: await encryptText(k, turn.question, `${qid}#msg`) },
      { id: aid, role: 'assistant', coverage: turn.answer.coverage, content: await encryptText(k, JSON.stringify({ answer: turn.answer, sources: turn.sources, web: turn.web }), `${aid}#msg`) },
    ],
  });
}

export async function renameChat(id: string, title: string): Promise<void> {
  await api('PATCH', `/api/conversations/${encodeURIComponent(id)}`, { title: await encryptText(key(), title.trim().slice(0, 200) || 'Untitled', `${id}#title`) });
}

export const deleteChat = (id: string) => api('DELETE', `/api/conversations/${encodeURIComponent(id)}`);
