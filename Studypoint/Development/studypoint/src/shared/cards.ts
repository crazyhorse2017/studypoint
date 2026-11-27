// Flashcards (CRD-01). Pure: what a card contains, which reviewable "variants" it has, how cloze text is
// parsed and shown, and how a typed answer is checked. The whole payload is encrypted in the browser
// (AUTH-08); the Worker only stores the ciphertext plus the card type and its variant ids.

export type CardType = 'basic' | 'cloze' | 'occlusion';

/** A hidden region on an image, in fractions (0..1) of the image's width and height. */
export type Mask = { id: string; x: number; y: number; w: number; h: number; label: string };

export type CardPayload =
  | { type: 'basic'; front: string; back: string; reversible: boolean; answerMode: 'reveal' | 'typed' }
  | { type: 'cloze'; text: string; extra: string }
  | { type: 'occlusion'; fileId: string; page: number | null; masks: Mask[]; caption: string; mode: 'hide-one' | 'hide-all' };

/** Variant ids the scheduler tracks separately (card_states.variant). */
export function variantsOf(p: CardPayload): string[] {
  if (p.type === 'basic') return p.reversible ? ['main', 'reverse'] : ['main'];
  if (p.type === 'cloze') return clozeNumbers(p.text).map((n) => `c${n}`);
  return p.masks.map((m) => `m:${m.id}`);
}

// ---------- cloze ----------

const CLOZE = /\{\{c(\d{1,2})::((?:[^{}]|\{[^{}]*\}|\{\{[^{}]*\}\})*?)(?:::([^{}]*?))?\}\}/g;

/** The deletion numbers used in the text, ascending and unique: "{{c1::a}} {{c3::b}} {{c1::c}}" → [1, 3]. */
export function clozeNumbers(text: string): number[] {
  const set = new Set<number>();
  for (const m of text.matchAll(CLOZE)) set.add(Number(m[1]));
  return [...set].sort((a, b) => a - b);
}

export type ClozePiece = { kind: 'text'; text: string } | { kind: 'hidden'; answer: string; hint: string | null; active: boolean };

/**
 * Split cloze text for showing variant `cN`: deletions numbered N are hidden ("active"), the others are
 * shown as plain text.
 */
export function clozePieces(text: string, active: number): ClozePiece[] {
  const out: ClozePiece[] = [];
  let last = 0;
  for (const m of text.matchAll(CLOZE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ kind: 'text', text: text.slice(last, at) });
    const n = Number(m[1]);
    if (n === active) out.push({ kind: 'hidden', answer: m[2] ?? '', hint: m[3]?.trim() ? (m[3] as string).trim() : null, active: true });
    else out.push({ kind: 'text', text: m[2] ?? '' });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

// ---------- typed answers ----------

/** Lower-case, trim, collapse spaces, drop surrounding punctuation and accents: for forgiving comparison. */
export function normaliseAnswer(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[“”"'`’]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.,;:!?]+|[\s.,;:!?]+$/g, '')
    .trim();
}

function asNumber(s: string): number | null {
  const t = s.replace(/[\s,]/g, '').replace(/×10\^?/i, 'e').replace(/x10\^?/i, 'e');
  return /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t) ? Number(t) : null;
}

export type AnswerCheck = { correct: boolean; reason: 'exact' | 'number' | 'close' | 'wrong' };

/**
 * Check a typed answer. Numbers count within 1% (or 1e-9 absolute near zero); text counts if it matches
 * after normalising, or is one small typo away for answers of 6+ characters.
 */
export function checkTypedAnswer(typed: string, expected: string): AnswerCheck {
  const a = normaliseAnswer(typed);
  const b = normaliseAnswer(expected);
  if (!a) return { correct: false, reason: 'wrong' };
  if (a === b) return { correct: true, reason: 'exact' };
  const na = asNumber(a);
  const nb = asNumber(b);
  if (na !== null && nb !== null) {
    const ok = Math.abs(na - nb) <= Math.max(1e-9, Math.abs(nb) * 0.01);
    return { correct: ok, reason: ok ? 'number' : 'wrong' };
  }
  if (b.length >= 6 && editDistanceAtMost1(a, b)) return { correct: true, reason: 'close' };
  return { correct: false, reason: 'wrong' };
}

function editDistanceAtMost1(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (a.length > b.length) i += 1;
    else if (a.length < b.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

// ---------- validation (client, before encrypting) ----------

export function payloadProblem(p: CardPayload): string | null {
  if (p.type === 'basic') {
    if (!p.front.trim()) return 'Write the front of the card.';
    if (!p.back.trim()) return 'Write the answer on the back.';
    return null;
  }
  if (p.type === 'cloze') {
    if (clozeNumbers(p.text).length === 0) return 'Mark at least one blank, like {{c1::answer}}, or select text and press “Make blank”.';
    return null;
  }
  if (p.masks.length === 0) return 'Draw at least one box over the part to hide.';
  if (p.masks.some((m) => m.w <= 0.005 || m.h <= 0.005)) return 'One of the boxes is too small to see.';
  return null;
}

export const VARIANT_RE = /^(main|reverse|c\d{1,2}|m:[A-Za-z0-9_-]{1,40})$/;
