// Retrieval helpers (ARCHITECTURE A6, AI_SYSTEM §3). Pure.

/**
 * Reciprocal-rank fusion of several ranked id lists (keyword FTS5 + Vectorize).
 * score(id) = Σ 1 / (k + rank), rank starting at 1. Ties keep the order of first appearance.
 */
export function reciprocalRankFusion(lists: ReadonlyArray<readonly string[]>, k = 60): Array<{ id: string; score: number }> {
  const scores = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  let seen = 0;
  for (const list of lists) {
    const local = new Set<string>();
    list.forEach((id, i) => {
      if (local.has(id)) return; // count an id once per list
      local.add(id);
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1));
      if (!firstSeen.has(id)) firstSeen.set(id, seen++);
    });
  }
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score || (firstSeen.get(a.id) ?? 0) - (firstSeen.get(b.id) ?? 0));
}

/**
 * Turn free text into a safe FTS5 MATCH query: words are quoted (so user input can't inject FTS syntax like
 * NEAR/AND/column filters) and OR-ed, so any shared term retrieves the passage and BM25 ranks it.
 */
export function ftsQuery(text: string, maxTerms = 24): string | null {
  const terms = (text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => t.length > 1 || /\d/.test(t));
  const unique = [...new Set(terms)].slice(0, maxTerms);
  if (unique.length === 0) return null;
  return unique.map((t) => `"${t.replace(/"/g, '""')}"`).join(' OR ');
}
