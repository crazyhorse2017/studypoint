// Passage-level diff between two versions of a source (LIB-10, SRC-01, ARCHITECTURE §3.3 step 5). Pure.
// 1. Exact matches by normalised-content hash are "unchanged".
// 2. Remaining old/new passages are aligned greedily by word-set similarity: above the threshold they're
//    "modified" (cards citing them get a "source changed" flag with a side-by-side diff).
// 3. Old passages left over are "removed"; new ones left over are "added".

export type DiffPassage = { id: string; hash: string; text: string };

export type PassageDiff = {
  unchanged: Array<{ oldId: string; newId: string }>;
  modified: Array<{ oldId: string; newId: string; similarity: number }>;
  removed: string[];
  added: string[];
};

export const MODIFIED_THRESHOLD = 0.5;

/** Normalised text used for the content hash: lowercase, collapsed whitespace, no Markdown emphasis. */
export function normaliseForHash(text: string): string {
  return text.normalize('NFKC').replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function words(text: string): Set<string> {
  return new Set(normaliseForHash(text).match(/[\p{L}\p{N}]+/gu) ?? []);
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter += 1;
  return inter / (a.size + b.size - inter);
}

export function diffPassages(oldPs: readonly DiffPassage[], newPs: readonly DiffPassage[], threshold = MODIFIED_THRESHOLD): PassageDiff {
  const unchanged: PassageDiff['unchanged'] = [];
  const newByHash = new Map<string, DiffPassage[]>();
  for (const p of newPs) newByHash.set(p.hash, [...(newByHash.get(p.hash) ?? []), p]);

  const usedNew = new Set<string>();
  const leftoverOld: DiffPassage[] = [];
  for (const o of oldPs) {
    const candidates = (newByHash.get(o.hash) ?? []).filter((n) => !usedNew.has(n.id));
    const match = candidates[0];
    if (match) {
      unchanged.push({ oldId: o.id, newId: match.id });
      usedNew.add(match.id);
    } else {
      leftoverOld.push(o);
    }
  }
  const leftoverNew = newPs.filter((n) => !usedNew.has(n.id));

  // Greedy best-pair alignment of what's left.
  const oldWords = new Map(leftoverOld.map((o) => [o.id, words(o.text)]));
  const newWords = new Map(leftoverNew.map((n) => [n.id, words(n.text)]));
  const pairs: Array<{ oldId: string; newId: string; similarity: number }> = [];
  for (const o of leftoverOld) {
    for (const n of leftoverNew) {
      const s = jaccard(oldWords.get(o.id) as Set<string>, newWords.get(n.id) as Set<string>);
      if (s >= threshold) pairs.push({ oldId: o.id, newId: n.id, similarity: Number(s.toFixed(3)) });
    }
  }
  pairs.sort((a, b) => b.similarity - a.similarity);
  const modified: PassageDiff['modified'] = [];
  const pairedOld = new Set<string>();
  const pairedNew = new Set<string>();
  for (const p of pairs) {
    if (pairedOld.has(p.oldId) || pairedNew.has(p.newId)) continue;
    modified.push(p);
    pairedOld.add(p.oldId);
    pairedNew.add(p.newId);
  }
  return {
    unchanged,
    modified,
    removed: leftoverOld.filter((o) => !pairedOld.has(o.id)).map((o) => o.id),
    added: leftoverNew.filter((n) => !pairedNew.has(n.id)).map((n) => n.id),
  };
}
