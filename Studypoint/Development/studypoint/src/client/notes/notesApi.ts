// Notes on the client (LIB-08 + AUTH-08). Everything is encrypted HERE, before it leaves the browser:
// the title with AAD "<id>#title" and the body with "<id>#body", so ciphertexts can't be swapped between
// notes or between fields. The body is the editor's own JSON document (lossless, math included), wrapped
// as { format: 'tiptap@1', doc }. Markdown is derived from it in the browser when needed (export, AI).

import type { JSONContent } from '@tiptap/core';
import { api } from '../api.ts';
import { decryptText, encryptText } from '../../shared/crypto/vault.ts';
import { uuid7 } from '../../shared/uuid7.ts';
import { currentDataKey } from '../vault/vaultStore.ts';

/** The editor's document (type-only import: no editor code is pulled into the main bundle). */
export type JsonDoc = JSONContent & { type: 'doc' };
export const EMPTY_DOC: JsonDoc = { type: 'doc', content: [{ type: 'paragraph' }] };

type ServerSummary = { id: string; courseId: string | null; title: string; createdAt: number; updatedAt: number };
type ServerNote = ServerSummary & { body: string };

export type NoteItem = { id: string; courseId: string | null; title: string; updatedAt: number; unreadable: boolean };
export type OpenNote = { id: string; courseId: string | null; title: string; doc: JsonDoc; updatedAt: number };

function key(): CryptoKey {
  const k = currentDataKey();
  if (!k) throw new Error('Studyflare is locked. Unlock it to open your notes.');
  return k;
}

/** The text shown for a note with no title yet. */
export const UNTITLED = 'Untitled note';

export async function fetchNotes(courseId?: string | null): Promise<NoteItem[]> {
  const k = key();
  const q = courseId ? `?course=${encodeURIComponent(courseId)}` : '';
  const { notes } = await api<{ notes: ServerSummary[] }>('GET', `/api/notes${q}`);
  return Promise.all(
    notes.map(async (n) => {
      try {
        return { id: n.id, courseId: n.courseId, title: await decryptText(k, n.title, `${n.id}#title`), updatedAt: n.updatedAt, unreadable: false };
      } catch {
        return { id: n.id, courseId: n.courseId, title: 'Can’t be decrypted', updatedAt: n.updatedAt, unreadable: true };
      }
    }),
  );
}

async function seal(id: string, title: string, doc: JsonDoc) {
  const k = key();
  return {
    title: await encryptText(k, title, `${id}#title`),
    body: await encryptText(k, JSON.stringify({ format: 'tiptap@1', doc }), `${id}#body`),
  };
}

export async function createNote(courseId: string | null): Promise<string> {
  const id = uuid7();
  await api('POST', '/api/notes', { id, courseId, ...(await seal(id, '', EMPTY_DOC)) });
  return id;
}

export async function loadNote(id: string): Promise<OpenNote> {
  const k = key();
  const { note } = await api<{ note: ServerNote }>('GET', `/api/notes/${encodeURIComponent(id)}`);
  const title = await decryptText(k, note.title, `${id}#title`);
  const parsed = JSON.parse(await decryptText(k, note.body, `${id}#body`)) as { format?: string; doc?: JsonDoc };
  if (parsed.format !== 'tiptap@1' || !parsed.doc || parsed.doc.type !== 'doc') throw new Error('This note was saved in a format this version can’t open.');
  return { id, courseId: note.courseId, title, doc: parsed.doc, updatedAt: note.updatedAt };
}

/** Saves a new version; returns the server's new updatedAt (pass it back next time). */
export async function saveNote(id: string, input: { title: string; doc: JsonDoc; courseId: string | null }, baseUpdatedAt: number): Promise<number> {
  const { note } = await api<{ note: ServerSummary }>('PUT', `/api/notes/${encodeURIComponent(id)}`, {
    ...(await seal(id, input.title, input.doc)),
    courseId: input.courseId,
    baseUpdatedAt,
  });
  return note.updatedAt;
}

export async function deleteNote(id: string): Promise<void> {
  await api('DELETE', `/api/notes/${encodeURIComponent(id)}`);
}

export async function restoreNote(id: string): Promise<void> {
  await api('POST', `/api/notes/${encodeURIComponent(id)}/restore`);
}
