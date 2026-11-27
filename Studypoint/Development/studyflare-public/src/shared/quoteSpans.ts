// Which pieces of a page's text hold a quote (step 6a, LIB-09): used to highlight a cited passage in the
// PDF text layer, where a sentence is split across many positioned spans. Pure. Matching reuses the
// citation verifier, loosely (OCR tolerance), since the text layer's spacing differs from the passage's.

import { verifyQuote } from './citations.ts';

/** Indexes of the `pieces` the quote covers, in order; empty when the quote isn't on this page. */
export function piecesForQuote(pieces: readonly string[], quote: string): number[] {
  const starts: number[] = [];
  let joined = '';
  for (const p of pieces) {
    if (joined && !/\s$/.test(joined) && !/^\s/.test(p)) joined += ' ';
    starts.push(joined.length);
    joined += p;
  }
  const r = verifyQuote(quote, joined, { ocr: true });
  if (!r.verified || r.start === null || r.end === null) return [];
  const { start, end } = r;
  const out: number[] = [];
  pieces.forEach((p, i) => {
    const s = starts[i] ?? 0;
    const e = s + p.length;
    if (p.trim() && s < end && e > start) out.push(i);
  });
  return out;
}

/** `/files/<id>?page=N` → its file id and page. Notes and web pages give null. */
export function fileTarget(href: string): { sourceId: string; page: number | null } | null {
  const m = /^\/files\/([^/?#]+)(?:\?page=(\d+))?/.exec(href);
  if (!m || !m[1]) return null;
  return { sourceId: m[1], page: m[2] ? Number(m[2]) : null };
}

export type QuoteWindow = { before: string; match: string; after: string };

/** The passage around a quote (for the citation preview): about `room` characters either side. */
export function quoteWindow(text: string, quote: string, ocr: boolean, room = 280): QuoteWindow | null {
  const r = verifyQuote(quote, text, { ocr });
  if (r.start === null || r.end === null) return null;
  const from = Math.max(0, r.start - room);
  const to = Math.min(text.length, r.end + room);
  return { before: (from > 0 ? '…' : '') + text.slice(from, r.start), match: text.slice(r.start, r.end), after: text.slice(r.end, to) + (to < text.length ? '…' : '') };
}

/** A cited quote to highlight when a file opens (kept in memory only, never in the URL). */
export type PendingHighlight = { sourceId: string; page: number | null; quote: string };
