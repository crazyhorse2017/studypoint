// Streaming answer parser (AST-01..05, AI_SYSTEM §5.1–5.2). Pure.
// The model writes sentences with inline citation markers ⟦P3: "exact quote"⟧, wraps general knowledge in
// <general>…</general>, opens with <coverage>…</coverage>, and may add <conflict>/<uncertain> tags.
// Chunks arrive in arbitrary pieces, so this buffers until a sentence is complete and only then emits it
// (with its markers removed and its citations listed) for the citation verifier to check.

export type Coverage = 'covered' | 'partial' | 'not_found';

export type ParsedCitation = { ref: string; quote: string };

export type SentenceEvent = {
  type: 'sentence';
  /** Display text with markers and tags removed. */
  text: string;
  /** general = inside <general>; cited = has markers (verify them); uncited = no markers outside <general>. */
  kind: 'general' | 'cited' | 'uncited';
  citations: ParsedCitation[];
  conflict: boolean;
  uncertain: boolean;
};

export type ParseEvent = { type: 'coverage'; value: Coverage } | SentenceEvent;

const MARKER_RE = /⟦\s*(P\d+)\s*:\s*"([^"]*)"\s*⟧/g;
const COVERAGE_RE = /<coverage>\s*(covered|partial|not_found)\s*<\/coverage>/;

/** Index just past the end of the first complete sentence in `s`, or -1. Ignores ends inside $…$, markers or tags. */
export function sentenceEnd(s: string): number {
  let inMath = false;
  let inMarker = false;
  let inTag = false;
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i] as string;
    if (c === '⟦') inMarker = true;
    else if (c === '⟧') inMarker = false;
    else if (c === '<') inTag = true;
    else if (c === '>') inTag = false;
    else if (c === '$' && !inMarker) inMath = !inMath;
    if (inMath || inMarker || inTag) continue;
    if (c === '\n' && s[i + 1] === '\n') return i + 2; // paragraph break
    if (c === '.' || c === '!' || c === '?') {
      // Swallow trailing closers, then any citation markers and <conflict/>/<uncertain/> tags that belong to
      // this sentence:  ."   .)   . <conflict/> ⟦P1: "…"⟧ ⟦P3: "…"⟧
      let j = i + 1;
      while (j < s.length && /["')\]]/.test(s[j] as string)) j += 1;
      if (j >= s.length) return -1; // can't tell yet whether the sentence ended (e.g. "3." of "3.5")
      if (!/\s/.test(s[j] as string)) continue; // "3.5", "e.g" — not a sentence end
      for (;;) {
        let k = j;
        while (k < s.length && s[k] === ' ') k += 1;
        if (k >= s.length) return -1; // a marker or tag may still be on its way
        if (s[k] === '⟦') {
          const close = s.indexOf('⟧', k);
          if (close === -1) return -1; // marker still streaming in
          j = close + 1;
          continue;
        }
        if (s[k] === '<') {
          const rest = s.slice(k);
          const tag = /^<\/?(conflict|uncertain)\s*\/?>/.exec(rest);
          if (tag) {
            j = k + tag[0].length;
            continue;
          }
          // Could be the start of one of those tags, still incomplete.
          if (!rest.includes('>') && /^<\/?[a-z]*\s*\/?$/.test(rest)) return -1;
        }
        return j;
      }
    }
  }
  return -1;
}

export function createSegmentParser() {
  let buffer = '';
  let inGeneral = false;
  let coverageSent = false;

  const emitSentence = (raw: string): SentenceEvent | null => {
    let text = raw;
    const conflict = /<conflict\s*\/?>|<\/?conflict>/.test(text);
    const uncertain = /<uncertain\s*\/?>|<\/?uncertain>/.test(text);
    const citations: ParsedCitation[] = [];
    text = text.replace(MARKER_RE, (_m, ref: string, quote: string) => {
      citations.push({ ref, quote });
      return '';
    });
    text = text.replace(/<\/?(conflict|uncertain)\s*\/?>/g, '').replace(/\s+([.,;:!?])/g, '$1').replace(/\s{2,}/g, ' ').trim();
    if (!text) return null;
    const kind: SentenceEvent['kind'] = inGeneral ? 'general' : citations.length > 0 ? 'cited' : 'uncited';
    return { type: 'sentence', text, kind, citations: inGeneral ? [] : citations, conflict, uncertain };
  };

  // Process the buffer up to `limit` characters, handling <general> boundaries.
  const drain = (final: boolean): ParseEvent[] => {
    const events: ParseEvent[] = [];
    if (!coverageSent) {
      const m = COVERAGE_RE.exec(buffer);
      if (m) {
        events.push({ type: 'coverage', value: m[1] as Coverage });
        buffer = buffer.slice(0, m.index) + buffer.slice(m.index + m[0].length);
        coverageSent = true;
      } else if (!final && buffer.length < 200 && /^\s*(<c?o?v?e?r?a?g?e?)?/.test(buffer) && buffer.trimStart().startsWith('<')) {
        return events; // the coverage tag is probably still streaming in
      }
    }
    for (;;) {
      const tag = inGeneral ? buffer.indexOf('</general>') : buffer.indexOf('<general>');
      const end = sentenceEnd(buffer);
      if (tag !== -1 && (end === -1 || tag < end)) {
        const before = buffer.slice(0, tag);
        const ev = emitSentence(before);
        if (ev) events.push(ev);
        buffer = buffer.slice(tag + (inGeneral ? '</general>'.length : '<general>'.length));
        inGeneral = !inGeneral;
        continue;
      }
      if (end !== -1) {
        const ev = emitSentence(buffer.slice(0, end));
        if (ev) events.push(ev);
        buffer = buffer.slice(end);
        continue;
      }
      break;
    }
    if (final) {
      const ev = emitSentence(buffer.replace(/<\/?general>/g, ''));
      if (ev) events.push(ev);
      buffer = '';
    }
    return events;
  };

  return {
    push(chunk: string): ParseEvent[] {
      buffer += chunk;
      return drain(false);
    },
    end(): ParseEvent[] {
      return drain(true);
    },
  };
}
