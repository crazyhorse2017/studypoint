// Turning the assistant's reply into what Alex sees (AST-01..05, AI_SYSTEM §5.2, AGENTS 4). Pure.
// Every ⟦P#: "quote"⟧ is checked against the passage it names: verified citations are kept, failed ones
// dropped, and a sentence with no verified citation is shown as "unverified", never as cited.
// <general> text is labelled general knowledge.

import { verifyQuote } from './citations.ts';
import { createSegmentParser, type Coverage } from './segments.ts';

export type AnswerPassage = { ref: string; text: string; ocr: boolean };
export type VerifiedCitation = { ref: string; quote: string; verified: boolean };

export type Segment = {
  kind: 'sourced' | 'unverified' | 'general' | 'plain';
  text: string;
  citations: VerifiedCitation[];
  conflict: boolean;
  uncertain: boolean;
};

export type VerifiedAnswer = { coverage: Coverage; segments: Segment[]; verifiedCount: number; failedCount: number };

export function verifyAnswer(raw: string, passages: readonly AnswerPassage[]): VerifiedAnswer {
  const parser = createSegmentParser();
  const events = [...parser.push(raw), ...parser.end()];
  let coverage: Coverage = 'partial';
  const segments: Segment[] = [];
  let verifiedCount = 0;
  let failedCount = 0;
  for (const e of events) {
    if (e.type === 'coverage') {
      coverage = e.value;
      continue;
    }
    if (e.kind === 'general') {
      segments.push({ kind: 'general', text: e.text, citations: [], conflict: e.conflict, uncertain: e.uncertain });
      continue;
    }
    if (e.kind === 'uncited') {
      segments.push({ kind: 'plain', text: e.text, citations: [], conflict: e.conflict, uncertain: e.uncertain });
      continue;
    }
    const checked = e.citations.map((c) => {
      const p = passages.find((x) => x.ref === c.ref);
      const verified = Boolean(p && verifyQuote(c.quote, p.text, { ocr: p.ocr }).verified);
      if (verified) verifiedCount += 1;
      else failedCount += 1;
      return { ref: c.ref, quote: c.quote, verified };
    });
    const ok = checked.filter((c) => c.verified);
    segments.push({ kind: ok.length > 0 ? 'sourced' : 'unverified', text: e.text, citations: ok.length > 0 ? ok : checked, conflict: e.conflict, uncertain: e.uncertain });
  }
  return { coverage, segments, verifiedCount, failedCount };
}
