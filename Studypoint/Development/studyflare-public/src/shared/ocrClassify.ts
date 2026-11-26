// Does a page need OCR? (LIB-04, ARCHITECTURE §3.3 step 2, AI_SYSTEM §8). Pure.
// A page goes to OCR if its text layer is too thin, mostly non-words, or full of the garbage glyphs that
// PDF-embedded equations extract as. Thresholds are starting values, tuned on the eval set.

export const OCR_THRESHOLDS = { minChars: 200, minWordRatio: 0.6, maxGarbageRatio: 0.05 } as const;

export type OcrDecision = {
  needsOcr: boolean;
  reasons: Array<'too_little_text' | 'few_words' | 'garbage_glyphs'>;
  chars: number;
  wordRatio: number;
  garbageRatio: number;
};

// Private-use area, replacement character, and the math-alphanumeric block that equation fonts map into.
const GARBAGE_RE = /[-�]|[\u{1D400}-\u{1D7FF}]/gu;

export function classifyPageText(text: string, t = OCR_THRESHOLDS): OcrDecision {
  const compact = text.replace(/\s+/g, ' ').trim();
  const chars = [...compact].length;
  const tokens = compact.split(' ').filter(Boolean);
  // A "word" is mostly letters, 2+ long (allowing a trailing punctuation mark).
  const wordLike = tokens.filter((w) => /^[\p{L}][\p{L}'’-]*[\p{L}][.,;:!?)]?$/u.test(w)).length;
  const wordRatio = tokens.length === 0 ? 0 : wordLike / tokens.length;
  const garbage = (compact.match(GARBAGE_RE) ?? []).length;
  const garbageRatio = chars === 0 ? 0 : garbage / chars;

  const reasons: OcrDecision['reasons'] = [];
  if (chars < t.minChars) reasons.push('too_little_text');
  if (tokens.length > 0 && wordRatio < t.minWordRatio) reasons.push('few_words');
  if (garbageRatio > t.maxGarbageRatio) reasons.push('garbage_glyphs');
  return { needsOcr: reasons.length > 0, reasons, chars, wordRatio: Number(wordRatio.toFixed(3)), garbageRatio: Number(garbageRatio.toFixed(3)) };
}
