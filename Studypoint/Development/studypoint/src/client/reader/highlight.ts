// The quote to highlight when a citation opens a file (step 6a, LIB-09). Held in memory for this tab only:
// it's your decrypted material, so it never goes in the URL (which reaches server logs) or in storage.

import type { PendingHighlight } from '../../shared/quoteSpans.ts';

let pending: PendingHighlight | null = null;

export function setPendingHighlight(h: PendingHighlight | null): void {
  pending = h;
}

/** The highlight for this file, once: reading it clears it, so a later visit opens plainly. */
export function takeHighlight(sourceId: string): PendingHighlight | null {
  if (!pending || pending.sourceId !== sourceId) return null;
  const h = pending;
  pending = null;
  return h;
}
