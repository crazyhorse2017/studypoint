// In-browser search over decrypted passages (step 5, A24, LIB-07). Pure. Personal content is encrypted, so
// the server can't index it: keyword ranking (BM25) and meaning-based ranking (embedding cosine) both run
// on this device, fused with reciprocal-rank fusion (A6).

import { reciprocalRankFusion } from './retrieval.ts';

export type IndexedPassage = {
  /** `${sourceId}:${n}` */
  id: string;
  sourceId: string;
  /** "p. 12", "Slide 4", "Heading › Sub", "Photo" … */
  loc: string;
  /** PDF page or slide number to open the Reader at, or null. */
  page: number | null;
  text: string;
  ocr: boolean;
};

export type Bundle = {
  v: 1;
  sourceId: string;
  /** Files open in the Reader; notes open in the note editor. */
  kind: 'file' | 'note';
  title: string;
  model: string;
  dims: number;
  passages: IndexedPassage[];
  /** One int8 vector per passage, concatenated, base64. */
  vecs: string;
  /** Per-vector scale to undo the int8 quantisation. */
  scales: number[];
};

// ---------------------------------------------------------------- vectors --

export function normalise(v: readonly number[]): number[] {
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
}

/** Int8 quantisation (4× smaller bundles); cosine on unit vectors survives it with tiny error. */
export function quantise(v: readonly number[]): { q: Int8Array; scale: number } {
  const u = normalise(v);
  const max = Math.max(1e-9, ...u.map(Math.abs));
  const scale = max / 127;
  return { q: Int8Array.from(u, (x) => Math.round(x / scale)), scale };
}

export function packVectors(vectors: readonly (readonly number[])[]): { vecs: string; scales: number[]; dims: number } {
  const dims = vectors[0]?.length ?? 0;
  const all = new Int8Array(vectors.length * dims);
  const scales: number[] = [];
  vectors.forEach((v, i) => {
    const { q, scale } = quantise(v);
    all.set(q, i * dims);
    scales.push(scale);
  });
  let bin = '';
  const bytes = new Uint8Array(all.buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { vecs: btoa(bin), scales, dims };
}

export function unpackVectors(b: Pick<Bundle, 'vecs' | 'scales' | 'dims'>): Float32Array[] {
  const bin = atob(b.vecs);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  const all = new Int8Array(bytes.buffer);
  return b.scales.map((s, i) => Float32Array.from(all.subarray(i * b.dims, (i + 1) * b.dims), (x) => x * s));
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] as number;
    const y = b[i] as number;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

// ---------------------------------------------------------------- keywords (BM25) --

const STOP = new Set('a an and are as at be by for from has have in is it its of on or that the this to was were will with what which how why when where who'.split(' '));

export function terms(text: string): string[] {
  return (text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+(?:\.[\p{N}]+)?/gu) ?? []).filter((t) => (t.length > 1 || /\d/.test(t)) && !STOP.has(t));
}

export type KeywordIndex = { df: Map<string, number>; docs: Array<{ id: string; tf: Map<string, number>; len: number }>; avgLen: number };

export function buildKeywordIndex(passages: readonly IndexedPassage[]): KeywordIndex {
  const df = new Map<string, number>();
  const docs = passages.map((p) => {
    const ts = terms(p.text);
    const tf = new Map<string, number>();
    for (const t of ts) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    return { id: p.id, tf, len: ts.length };
  });
  const avgLen = docs.reduce((n, d) => n + d.len, 0) / Math.max(1, docs.length);
  return { df, docs, avgLen };
}

export function bm25(index: KeywordIndex, query: string, limit = 30, k1 = 1.2, b = 0.75): string[] {
  const q = [...new Set(terms(query))];
  const N = index.docs.length;
  const scored: Array<{ id: string; s: number }> = [];
  for (const d of index.docs) {
    let s = 0;
    for (const t of q) {
      const f = d.tf.get(t);
      if (!f) continue;
      const n = index.df.get(t) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      s += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + b * (d.len / (index.avgLen || 1)))));
    }
    if (s > 0) scored.push({ id: d.id, s });
  }
  return scored.sort((a, c) => c.s - a.s).slice(0, limit).map((x) => x.id);
}

// ---------------------------------------------------------------- hybrid --

export type Hit = { passage: IndexedPassage; score: number };

/** Keyword + meaning, fused. `queryVector` may be null (offline or quota used up): keywords alone then. */
export function hybridSearch(passages: readonly IndexedPassage[], vectors: ReadonlyMap<string, Float32Array>, kw: KeywordIndex, query: string, queryVector: readonly number[] | null, limit = 8): Hit[] {
  const lists: string[][] = [bm25(kw, query, 30)];
  if (queryVector) {
    lists.push(
      passages
        .map((p) => ({ id: p.id, s: vectors.has(p.id) ? cosine(queryVector, vectors.get(p.id) as Float32Array) : -1 }))
        .filter((x) => x.s > 0.2)
        .sort((a, b) => b.s - a.s)
        .slice(0, 30)
        .map((x) => x.id),
    );
  }
  const byId = new Map(passages.map((p) => [p.id, p]));
  return reciprocalRankFusion(lists)
    .slice(0, limit)
    .map((r) => ({ passage: byId.get(r.id) as IndexedPassage, score: r.score }))
    .filter((h) => h.passage);
}
