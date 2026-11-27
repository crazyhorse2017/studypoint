// Cards and review on the client (CRD-01..09, AUTH-08). Card content is encrypted here (AAD "<id>#card")
// before it's saved; the Worker sees only the type and the variant ids it schedules.

import { api } from '../api.ts';
import { decryptText, encryptText } from '../../shared/crypto/vault.ts';
import { variantsOf, type CardPayload, type CardType } from '../../shared/cards.ts';
import type { RatingNumber, StateRow } from '../../shared/fsrsState.ts';
import { uuid7 } from '../../shared/uuid7.ts';
import { currentDataKey } from '../vault/vaultStore.ts';

type ServerCard = { id: string; courseId: string | null; type: CardType; payload: string; variants: string[]; createdAt: number; updatedAt: number };
export type CardItem = Omit<ServerCard, 'payload'> & { payload: CardPayload | null };

export type QueueItem = StateRow & { cardId: string; variant: string; courseId: string | null; type: CardType; payload: CardPayload | null };
export type Exam = { courseId: string; at: number };
export type StudySettings = { newPerDay: number; retention: number };
export type Queue = { due: QueueItem[]; fresh: QueueItem[]; exams: Exam[]; settings: StudySettings };
export type Summary = {
  dueNow: number; dueToday: number; newAvailable: number; newToday: number; reviewedToday: number;
  exams: Array<Exam & { unseen: number; onTrack: boolean; daysLeft: number }>;
};

function key(): CryptoKey {
  const k = currentDataKey();
  if (!k) throw new Error('Studyflare is locked. Unlock it to use your cards.');
  return k;
}

async function open(id: string, payload: string): Promise<CardPayload | null> {
  try {
    return JSON.parse(await decryptText(key(), payload, `${id}#card`)) as CardPayload;
  } catch {
    return null;
  }
}

export async function fetchCards(courseId: string | null): Promise<CardItem[]> {
  const q = courseId ? `?course=${encodeURIComponent(courseId)}` : '';
  const { cards } = await api<{ cards: ServerCard[] }>('GET', `/api/cards${q}`);
  return Promise.all(cards.map(async (c) => ({ ...c, payload: await open(c.id, c.payload) })));
}

async function seal(id: string, p: CardPayload) {
  return { type: p.type, variants: variantsOf(p), payload: await encryptText(key(), JSON.stringify(p), `${id}#card`) };
}

export async function createCard(courseId: string, p: CardPayload): Promise<string> {
  const id = uuid7();
  await api('POST', '/api/cards', { id, courseId, ...(await seal(id, p)) });
  return id;
}

export async function updateCard(id: string, p: CardPayload, courseId?: string): Promise<void> {
  await api('PUT', `/api/cards/${encodeURIComponent(id)}`, { ...(await seal(id, p)), ...(courseId ? { courseId } : {}) });
}

export async function deleteCard(id: string): Promise<void> {
  await api('DELETE', `/api/cards/${encodeURIComponent(id)}`);
}

export async function restoreCard(id: string): Promise<void> {
  await api('POST', `/api/cards/${encodeURIComponent(id)}/restore`);
}

type ServerQueueItem = Omit<QueueItem, 'payload'> & { payload: string };

export async function fetchQueue(courseId: string | null): Promise<Queue> {
  const q = courseId ? `?course=${encodeURIComponent(courseId)}` : '';
  const r = await api<{ due: ServerQueueItem[]; fresh: ServerQueueItem[]; exams: Exam[]; settings: StudySettings }>('GET', `/api/review/queue${q}`);
  // Decrypt each card once, even when several of its sides are in the queue.
  const cache = new Map<string, Promise<CardPayload | null>>();
  const dec = (i: ServerQueueItem) => {
    let p = cache.get(i.cardId);
    if (!p) {
      p = open(i.cardId, i.payload);
      cache.set(i.cardId, p);
    }
    return p.then((payload) => ({ ...i, payload }));
  };
  return { due: await Promise.all(r.due.map(dec)), fresh: await Promise.all(r.fresh.map(dec)), exams: r.exams, settings: r.settings };
}

export async function sendReview(input: { clientId: string; cardId: string; variant: string; rating: RatingNumber; reviewedAt: number; durationMs: number }): Promise<StateRow> {
  return (await api<{ state: StateRow }>('POST', '/api/review', input)).state;
}

export const fetchSummary = () => api<Summary>('GET', '/api/review/summary');
export const fetchStudySettings = () => api<{ settings: StudySettings; exams: Exam[] }>('GET', '/api/study-settings');
export const saveStudySettings = (s: Partial<StudySettings>) => api<{ settings: StudySettings }>('PATCH', '/api/study-settings', s);
export const setExamDate = (courseId: string, at: number | null) => api<{ exam: Exam | null }>('PUT', `/api/courses/${encodeURIComponent(courseId)}/exam`, { at });
