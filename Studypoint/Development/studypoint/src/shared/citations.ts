// Citation verifier (AST-02, AI_SYSTEM §5.3). Pure and deterministic.
// A citation is shown only if its quote is found in the cited passage: exactly after normalisation, or by a
// fuzzy match above the threshold (looser for OCR text). Offsets map back to the ORIGINAL passage text,
// so the reader can highlight the exact span.
//
// Known limit (AI_SYSTEM §5.3): a verified quote proves the text exists, not that it supports the claim.

export type CitationResult = {
  verified: boolean;
  /** 1 = exact after normalisation; < 1 = fuzzy similarity of the best matching span; 0 = nothing close. */
  score: number;
  /** Character range in the ORIGINAL passage text, when found. */
  start: number | null;
  end: number | null;
  reason: 'exact' | 'fuzzy' | 'too_short' | 'empty' | 'not_found';
};

export const MIN_QUOTE_TOKENS = 4;
export const FUZZY_THRESHOLD_TEXT = 0.92;
export const FUZZY_THRESHOLD_OCR = 0.85;

type Normalised = { text: string; map: number[] };

/**
 * Normalise for comparison, keeping a map from each output character to its source index:
 * NFKC; curly quotes and dashes unified; Markdown emphasis markers dropped; whitespace collapsed;
 * LaTeX spacing around braces and after commands removed, so `\frac {a} {b}` equals `\frac{a}{b}`.
 */
export function normaliseWithMap(input: string): Normalised {
  const out: string[] = [];
  const map: number[] = [];
  let pendingSpace = -1; // source index of a collapsed whitespace run, if any

  const push = (ch: string, at: number) => {
    out.push(ch);
    map.push(at);
  };

  for (let i = 0; i < input.length; i += 1) {
    let ch = (input[i] as string).normalize('NFKC');
    if (/\s/.test(ch)) {
      if (out.length > 0 && pendingSpace === -1) pendingSpace = i;
      continue;
    }
    if (ch === '*' || ch === '_' || ch === '`') continue; // Markdown emphasis / code markers
    if ('‘’‚‛′'.includes(ch)) ch = "'";
    else if ('“”„‟″'.includes(ch)) ch = '"';
    else if ('‐‑‒–—―−'.includes(ch)) ch = '-';

    if (pendingSpace !== -1) {
      const prev = out[out.length - 1] ?? '';
      // LaTeX: drop spaces next to braces and right after a \command, e.g. "\frac {a}".
      const latexGlue = ch === '{' || ch === '}' || prev === '{' || prev === '}' || /\\[A-Za-z]+$/.test(out.slice(-12).join(''));
      if (!latexGlue) push(' ', pendingSpace);
      pendingSpace = -1;
    }
    for (const c of ch) push(c, i);
  }
  return { text: out.join(''), map };
}

function tokenCount(s: string): number {
  return s.split(' ').filter(Boolean).length;
}

/** Levenshtein distance with an early exit once it must exceed `limit` (banded). Returns limit + 1 if over. */
export function boundedLevenshtein(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  if (a === b) return 0;
  let prev = new Array<number>(b.length + 1);
  let cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    cur[0] = i;
    let rowMin = i;
    const lo = Math.max(1, i - limit);
    const hi = Math.min(b.length, i + limit);
    for (let j = 1; j < lo; j += 1) cur[j] = limit + 1;
    for (let j = lo; j <= hi; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min((prev[j] ?? limit + 1) + 1, (cur[j - 1] ?? limit + 1) + 1, (prev[j - 1] ?? limit + 1) + cost);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    for (let j = hi + 1; j <= b.length; j += 1) cur[j] = limit + 1;
    if (rowMin > limit) return limit + 1;
    [prev, cur] = [cur, prev];
  }
  const d = prev[b.length] ?? limit + 1;
  return d > limit ? limit + 1 : d;
}

/** Verify one quote against one passage. `ocr` passages use the looser fuzzy threshold (AI_SYSTEM §5.3). */
export function verifyQuote(quote: string, passage: string, opts: { ocr?: boolean } = {}): CitationResult {
  const q = normaliseWithMap(quote);
  const p = normaliseWithMap(passage);
  if (!q.text || !p.text) return { verified: false, score: 0, start: null, end: null, reason: 'empty' };
  if (tokenCount(q.text) < MIN_QUOTE_TOKENS) return { verified: false, score: 0, start: null, end: null, reason: 'too_short' };

  const span = (from: number, to: number) => ({ start: p.map[from] ?? 0, end: (p.map[to - 1] ?? 0) + 1 });

  const exact = p.text.indexOf(q.text);
  if (exact !== -1) return { verified: true, score: 1, ...span(exact, exact + q.text.length), reason: 'exact' };

  // Fuzzy: compare the quote with windows of the passage that have about the same number of tokens.
  const threshold = opts.ocr ? FUZZY_THRESHOLD_OCR : FUZZY_THRESHOLD_TEXT;
  const qLower = q.text.toLowerCase();
  const pLower = p.text.toLowerCase();
  const starts: number[] = [0];
  for (let i = 0; i < pLower.length; i += 1) if (pLower[i] === ' ') starts.push(i + 1);
  const qTokens = tokenCount(qLower);
  // Prefilter on character trigrams (robust to OCR typos, unlike whole-word overlap).
  const trigrams = (s: string) => {
    const set = new Set<string>();
    for (let i = 0; i + 3 <= s.length; i += 1) set.add(s.slice(i, i + 3));
    return set;
  };
  const qTri = trigrams(qLower);

  // Per-token trigram counts and hits, with prefix sums, so each candidate span's overlap costs O(1).
  const tokens = pLower.split(' ');
  const triTotal = [0];
  const triHits = [0];
  for (const tok of tokens) {
    const t = trigrams(tok);
    let hits = 0;
    for (const g of t) if (qTri.has(g)) hits += 1;
    triTotal.push((triTotal[triTotal.length - 1] as number) + t.size);
    triHits.push((triHits[triHits.length - 1] as number) + hits);
  }

  let best = { score: 0, from: -1, to: -1 };
  for (let s = 0; s < starts.length; s += 1) {
    for (const len of [qTokens - 1, qTokens, qTokens + 1]) {
      if (len < MIN_QUOTE_TOKENS || s + len > starts.length) continue;
      // Cheap prefilter (within-word trigrams): a fuzzy match at >= 0.85 similarity shares well over a third of them.
      const total = (triTotal[s + len] as number) - (triTotal[s] as number);
      const shared = (triHits[s + len] as number) - (triHits[s] as number);
      if (shared < 0.35 * Math.min(qTri.size, total)) continue;
      const from = starts[s] as number;
      const to = s + len < starts.length ? (starts[s + len] as number) - 1 : pLower.length;
      const win = pLower.slice(from, to);
      const longest = Math.max(win.length, qLower.length);
      const limit = Math.floor((1 - threshold) * longest);
      const d = boundedLevenshtein(win, qLower, limit);
      if (d > limit) continue;
      const score = 1 - d / longest;
      if (score > best.score) best = { score, from, to };
    }
  }

  if (best.from >= 0 && best.score >= threshold) {
    return { verified: true, score: Number(best.score.toFixed(4)), ...span(best.from, best.to), reason: 'fuzzy' };
  }
  return { verified: false, score: Number(best.score.toFixed(4)), start: null, end: null, reason: 'not_found' };
}
