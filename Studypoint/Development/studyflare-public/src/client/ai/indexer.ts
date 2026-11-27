// Processing material for AI (step 5, A24): each file, imported page and note in a course is read here
// (extract.ts), cut into passages (shared/chunker.ts), given search vectors (Workers AI), then saved as ONE
// encrypted bundle per source. Searching loads and decrypts a course's bundles in this browser.
// A source is reprocessed only when its content fingerprint changes.

import { api, ApiError } from '../api.ts';
import { chunkLocation } from '../../shared/chunker.ts';
import { fingerprint, openBytes, sealBytes } from '../../shared/crypto/vault.ts';
import { buildKeywordIndex, hybridSearch, packVectors, unpackVectors, type Bundle, type Hit, type IndexedPassage, type KeywordIndex } from '../../shared/searchIndex.ts';
import { currentDataKey, currentFingerprintKey } from '../vault/vaultStore.ts';
import { fetchFiles, openFile, type FileItem } from '../files/filesApi.ts';
import { fetchNotes, loadNote, type NoteItem } from '../notes/notesApi.ts';
import { embedTexts } from './aiApi.ts';
import { fileUnits, noteUnits, type Progress } from './extract.ts';

/** Bump when extraction or chunking changes, so everything is reprocessed once. */
const PROCESS_VERSION = 'v1';
const EMBED_LABEL = 'embed';

export type SourceRef =
  | { kind: 'file'; id: string; title: string; file: FileItem }
  | { kind: 'note'; id: string; title: string; note: NoteItem };

export type IndexInfo = { sourceId: string; fingerprint: string; passages: number; embedModel: string; bytes: number; updatedAt: number };

function key(): CryptoKey {
  const k = currentDataKey();
  if (!k) throw new Error('Studyflare is locked.');
  return k;
}

const aad = (sourceId: string) => `index:${sourceId}`;

/** Everything in a course that can be processed: ready files (not AI-made) and notes. */
export async function courseSources(courseId: string): Promise<SourceRef[]> {
  const [{ files }, notes] = await Promise.all([fetchFiles(courseId), fetchNotes(courseId)]);
  return [
    // AI-made materials are never used as sources (LKP-04), so they aren't processed for search/citations.
    ...files.filter((f) => f.status === 'ready' && !f.unreadable && f.origin !== 'ai').map((f): SourceRef => ({ kind: 'file', id: f.id, title: f.title, file: f })),
    ...notes.filter((n) => !n.unreadable).map((n): SourceRef => ({ kind: 'note', id: n.id, title: n.title || 'Untitled note', note: n })),
  ];
}

export async function listIndexes(courseId: string): Promise<IndexInfo[]> {
  return (await api<{ indexes: IndexInfo[] }>('GET', `/api/index?course=${encodeURIComponent(courseId)}`)).indexes;
}

async function sourceFingerprint(s: SourceRef): Promise<string> {
  const fp = await currentFingerprintKey();
  if (!fp) throw new Error('Studyflare is locked.');
  const version = s.kind === 'file' ? s.file.versionId : String(s.note.updatedAt);
  return fingerprint(fp, new TextEncoder().encode(`${PROCESS_VERSION}|${s.id}|${version}`));
}

/** Sources whose bundle is missing or out of date. */
export async function staleSources(courseId: string): Promise<{ all: SourceRef[]; stale: SourceRef[]; indexes: IndexInfo[] }> {
  const [all, indexes] = await Promise.all([courseSources(courseId), listIndexes(courseId)]);
  const have = new Map(indexes.map((i) => [i.sourceId, i.fingerprint]));
  const stale: SourceRef[] = [];
  for (const s of all) if (have.get(s.id) !== (await sourceFingerprint(s))) stale.push(s);
  return { all, stale, indexes };
}

/** Read, chunk, embed, encrypt and save one source. */
export async function processSource(s: SourceRef, progress: Progress = () => undefined): Promise<number> {
  progress(`Opening ${s.title}`);
  const units = s.kind === 'file'
    ? await fileUnits(s.file.kind, s.file.mime, await openFile(s.file), progress)
    : noteUnits((await loadNote(s.id)).doc as Parameters<typeof noteUnits>[0]);
  const passages: IndexedPassage[] = [];
  for (const u of units) {
    for (const c of chunkLocation(u.text)) passages.push({ id: `${s.id}:${passages.length}`, sourceId: s.id, loc: u.loc, page: u.page, text: c.text, ocr: u.ocr });
  }
  progress(passages.length ? `Making ${passages.length} passages searchable` : 'No readable text found');
  const vectors = passages.length ? await embedTexts(passages.map((p) => p.text.slice(0, 4000))) : [];
  const packed = packVectors(vectors);
  const bundle: Bundle = { v: 1, sourceId: s.id, kind: s.kind, title: s.title, model: EMBED_LABEL, dims: packed.dims, passages, vecs: packed.vecs, scales: packed.scales };
  const sealed = await sealBytes(key(), new TextEncoder().encode(JSON.stringify(bundle)), aad(s.id));
  const res = await fetch(`/api/index/${encodeURIComponent(s.id)}`, {
    method: 'PUT',
    body: sealed.slice().buffer as ArrayBuffer,
    headers: { 'Content-Type': 'application/octet-stream', 'X-Index-Fingerprint': await sourceFingerprint(s), 'X-Index-Passages': String(passages.length), 'X-Index-Model': encodeURIComponent(EMBED_LABEL) },
  });
  if (!res.ok) {
    let msg = 'The processed copy couldn’t be saved.';
    try {
      msg = ((await res.json()) as { error?: { message?: string } }).error?.message ?? msg;
    } catch {
      // not JSON
    }
    throw new ApiError(res.status, 'index_error', msg);
  }
  invalidate(s.id);
  return passages.length;
}

// ---------------------------------------------------------------- loading + search --

type Loaded = { fingerprint: string; bundle: Bundle; vectors: Map<string, Float32Array> };
const cache = new Map<string, Loaded>();

function invalidate(sourceId: string) {
  cache.delete(sourceId);
}

async function loadBundle(info: IndexInfo): Promise<Loaded | null> {
  const hit = cache.get(info.sourceId);
  if (hit && hit.fingerprint === info.fingerprint) return hit;
  const res = await fetch(`/api/index/${encodeURIComponent(info.sourceId)}`);
  if (!res.ok) return null;
  try {
    const plain = await openBytes(key(), new Uint8Array(await res.arrayBuffer()), aad(info.sourceId));
    const bundle = JSON.parse(new TextDecoder().decode(plain)) as Bundle;
    const vecs = bundle.dims ? unpackVectors(bundle) : [];
    const loaded: Loaded = { fingerprint: info.fingerprint, bundle, vectors: new Map(bundle.passages.map((p, i) => [p.id, vecs[i] as Float32Array])) };
    cache.set(info.sourceId, loaded);
    return loaded;
  } catch {
    return null;
  }
}

export type CourseIndex = { passages: IndexedPassage[]; vectors: Map<string, Float32Array>; kw: KeywordIndex; titles: Map<string, string>; noteIds: Set<string>; sources: number };

/** Every processed passage in a course, decrypted in this browser. */
export async function loadCourseIndex(courseId: string, onlySources?: ReadonlySet<string>): Promise<CourseIndex> {
  const infos = (await listIndexes(courseId)).filter((i) => !onlySources || onlySources.has(i.sourceId));
  const loaded = (await Promise.all(infos.map(loadBundle))).filter((x): x is Loaded => x !== null);
  const passages = loaded.flatMap((l) => l.bundle.passages);
  const vectors = new Map<string, Float32Array>();
  for (const l of loaded) for (const [k, v] of l.vectors) if (v) vectors.set(k, v);
  return {
    passages, vectors, kw: buildKeywordIndex(passages),
    titles: new Map(loaded.map((l) => [l.bundle.sourceId, l.bundle.title])),
    noteIds: new Set(loaded.filter((l) => l.bundle.kind === 'note').map((l) => l.bundle.sourceId)),
    sources: loaded.length,
  };
}

/** Hybrid search; falls back to keywords alone if the search model can't be reached. */
export async function searchCourse(index: CourseIndex, query: string, limit = 8): Promise<Hit[]> {
  let qv: number[] | null = null;
  if (index.vectors.size > 0) {
    try {
      qv = (await embedTexts([query]))[0] ?? null;
    } catch {
      qv = null;
    }
  }
  return hybridSearch(index.passages, index.vectors, index.kw, query, qv, limit);
}

/** Where a passage opens: the Reader at its page, or the note. */
export function passageLink(p: IndexedPassage, isNote: boolean): string {
  if (isNote) return `/notes/${p.sourceId}`;
  return p.page ? `/files/${p.sourceId}?page=${p.page}` : `/files/${p.sourceId}`;
}
