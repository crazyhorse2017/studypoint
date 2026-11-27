// Uploading and opening files (LIB-02, LIB-11, AUTH-08). Everything sensitive happens HERE, in the
// browser: the real file type is checked from its bytes, a keyed fingerprint spots duplicates, and the
// file is encrypted in 4 MiB chunks before upload. Opening reverses it: download, decrypt, reassemble.

import { ApiError, api } from '../api.ts';
import { chunkAad, decryptText, encryptText, openBytes, sealBytes, fingerprint } from '../../shared/crypto/vault.ts';
import { CHUNK_BYTES, chunkCount, sniffFile, titleFromFilename, type FileKind } from '../../shared/fileSniff.ts';
import { uuid7 } from '../../shared/uuid7.ts';
import { currentDataKey, currentFingerprintKey } from '../vault/vaultStore.ts';

export type ServerFile = {
  id: string; versionId: string; courseId: string | null; kind: FileKind; mime: string; bytes: number;
  chunks: number; title: string; status: 'uploading' | 'ready'; origin: 'upload' | 'link'; createdAt: number;
};
export type FileItem = Omit<ServerFile, 'title'> & { title: string; unreadable: boolean };

export class DuplicateFile extends Error {
  readonly existingId: string;
  constructor(message: string, existingId: string) {
    super(message);
    this.name = 'DuplicateFile';
    this.existingId = existingId;
  }
}

function key(): CryptoKey {
  const k = currentDataKey();
  if (!k) throw new Error('Studyflare is locked. Unlock it to use your files.');
  return k;
}

async function decryptTitle(f: ServerFile): Promise<FileItem> {
  try {
    return { ...f, title: await decryptText(key(), f.title, `${f.id}#title`), unreadable: false };
  } catch {
    return { ...f, title: 'Can’t be decrypted', unreadable: true };
  }
}

export async function fetchFiles(courseId?: string | null): Promise<{ files: FileItem[]; storage: boolean }> {
  const q = courseId ? `?course=${encodeURIComponent(courseId)}` : '';
  const r = await api<{ files: ServerFile[]; storage: boolean }>('GET', `/api/files${q}`);
  return { files: await Promise.all(r.files.map(decryptTitle)), storage: r.storage };
}

export async function fetchFile(id: string): Promise<FileItem> {
  const r = await api<{ file: ServerFile }>('GET', `/api/files/${encodeURIComponent(id)}`);
  return decryptTitle(r.file);
}

async function send(method: 'PUT' | 'GET', path: string, body?: Uint8Array): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(path, { method, body: body ? (body.slice().buffer as ArrayBuffer) : undefined, headers: body ? { 'Content-Type': 'application/octet-stream' } : {} });
  } catch {
    throw new ApiError(0, 'offline', "Studyflare can't be reached. Check your connection and try again.");
  }
  if (!res.ok) {
    let message = 'Something went wrong. Try again.';
    try {
      message = ((await res.json()) as { error?: { message?: string } }).error?.message ?? message;
    } catch {
      // not JSON
    }
    throw new ApiError(res.status, 'error', message);
  }
  return res;
}

async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i += 1) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) throw e; // a real refusal: don't retry
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
  throw last;
}

export type Progress = (done: number, total: number) => void;

/** Check, fingerprint, encrypt and upload one file into a course. Resolves to the new file's id. */
export async function uploadFile(file: File, courseId: string, onProgress: Progress = () => undefined, origin: 'upload' | 'link' = 'upload'): Promise<string> {
  const k = key();
  const fpKey = await currentFingerprintKey();
  if (!fpKey) throw new Error('Studyflare is locked. Unlock it to upload files.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sniff = sniffFile(bytes, file.name);
  if (!sniff.ok) throw new Error(sniff.reason);

  const sourceId = uuid7();
  const versionId = uuid7();
  const total = chunkCount(bytes.length);
  onProgress(0, total);
  try {
    await api('POST', '/api/files', {
      sourceId, versionId, courseId, kind: sniff.kind, mime: sniff.mime, bytes: bytes.length, origin,
      contentHash: await fingerprint(fpKey, bytes),
      title: await encryptText(k, titleFromFilename(file.name), `${sourceId}#title`),
    });
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      throw new DuplicateFile(`${file.name} is already in your library.`, '');
    }
    throw e;
  }
  for (let n = 0; n < total; n += 1) {
    const sealed = await sealBytes(k, bytes.subarray(n * CHUNK_BYTES, (n + 1) * CHUNK_BYTES), chunkAad(versionId, n, total));
    await withRetry(() => send('PUT', `/api/files/${versionId}/chunks/${n}`, sealed));
    onProgress(n + 1, total);
  }
  await withRetry(() => api('POST', `/api/files/${versionId}/complete`));
  return sourceId;
}

/** Download and decrypt a file. Every chunk is checked; a missing, swapped or altered chunk fails loudly. */
export async function openFile(f: FileItem, onProgress: Progress = () => undefined): Promise<Uint8Array> {
  const k = key();
  const out = new Uint8Array(f.bytes);
  onProgress(0, f.chunks);
  for (let n = 0; n < f.chunks; n += 1) {
    const res = await withRetry(() => send('GET', `/api/files/${f.versionId}/chunks/${n}`));
    const plain = await openBytes(k, new Uint8Array(await res.arrayBuffer()), chunkAad(f.versionId, n, f.chunks));
    out.set(plain, n * CHUNK_BYTES);
    onProgress(n + 1, f.chunks);
  }
  return out;
}

export async function deleteFile(id: string): Promise<void> {
  await api('DELETE', `/api/files/${encodeURIComponent(id)}`);
}

export async function restoreFile(id: string): Promise<void> {
  await api('POST', `/api/files/${encodeURIComponent(id)}/restore`);
}

export const KIND_LABEL: Record<FileKind, string> = { pdf: 'PDF', docx: 'Word', pptx: 'PowerPoint', image: 'Image', md: 'Markdown' };
export const KIND_EXT: Record<FileKind, string> = { pdf: '.pdf', docx: '.docx', pptx: '.pptx', image: '', md: '.md' };
