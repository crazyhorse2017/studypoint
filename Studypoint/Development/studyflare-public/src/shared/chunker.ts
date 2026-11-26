// Passage chunking (ARCHITECTURE §3.3 step 4, AI_SYSTEM §3). Pure.
// - Never crosses a location (page, slide or heading section): each location is chunked on its own.
// - Targets ~300–450 tokens per passage with ~50 tokens of overlap (bge-base embeds at most 512 tokens).
// - Never splits a $$…$$ display-math block or a Markdown table; an oversized one becomes its own passage.
// - Offsets (charStart/charEnd) point into the location's text, for citation highlighting.

export type ChunkOptions = { targetTokens?: number; maxTokens?: number; overlapTokens?: number };
export type Chunk = { ordinal: number; text: string; charStart: number; charEnd: number; tokenCount: number };

const DEFAULTS = { targetTokens: 380, maxTokens: 450, overlapTokens: 50 };

/** Token estimate without a tokenizer: the larger of ~1.33 tokens/word and ~4 chars/token. Conservative for bge's 512 limit. */
export function estimateTokens(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.ceil(Math.max(words * 1.33, text.length / 4));
}

type Block = { text: string; start: number; end: number; atomic: boolean };

/** Split location text into blocks: paragraphs, whole $$…$$ blocks and whole tables. */
export function splitBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const atomicRe = /\$\$[\s\S]*?\$\$|(?:^\|.*\|[ \t]*(?:\r?\n|$))+/gm;
  let cursor = 0;
  const pushParagraphs = (from: number, to: number) => {
    const seg = text.slice(from, to);
    const re = /\S[\s\S]*?(?=\n\s*\n|$)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(seg)) !== null) {
      const t = m[0].trimEnd();
      if (t) blocks.push({ text: t, start: from + m.index, end: from + m.index + t.length, atomic: false });
    }
  };
  let m: RegExpExecArray | null;
  while ((m = atomicRe.exec(text)) !== null) {
    if (m[0].trim() === '') {
      atomicRe.lastIndex += 1;
      continue;
    }
    pushParagraphs(cursor, m.index);
    const t = m[0].trimEnd();
    blocks.push({ text: t, start: m.index, end: m.index + t.length, atomic: true });
    cursor = m.index + m[0].length;
  }
  pushParagraphs(cursor, text.length);
  return blocks;
}

/** Split an over-long paragraph at sentence boundaries (falling back to words). */
function splitLong(block: Block, maxTokens: number): Block[] {
  if (block.atomic || estimateTokens(block.text) <= maxTokens) return [block];
  const pieces: Block[] = [];
  const sentenceRe = /[^.!?]+(?:[.!?]+["')\]]?|$)\s*/g;
  let m: RegExpExecArray | null;
  const units: Block[] = [];
  while ((m = sentenceRe.exec(block.text)) !== null) {
    if (!m[0]) break;
    const t = m[0].trimEnd();
    if (t) units.push({ text: t, start: block.start + m.index, end: block.start + m.index + t.length, atomic: false });
  }
  for (const u of units) {
    if (estimateTokens(u.text) <= maxTokens) {
      pieces.push(u);
      continue;
    }
    // A single enormous "sentence": cut by words.
    const words = [...u.text.matchAll(/\S+/g)];
    let from = 0;
    while (from < words.length) {
      let to = from;
      while (to < words.length && estimateTokens(words.slice(from, to + 1).map((w) => w[0]).join(' ')) <= maxTokens) to += 1;
      if (to === from) to = from + 1;
      const first = words[from] as RegExpMatchArray;
      const last = words[to - 1] as RegExpMatchArray;
      const s = u.start + (first.index ?? 0);
      const e = u.start + (last.index ?? 0) + last[0].length;
      pieces.push({ text: block.text.slice(s - block.start, e - block.start), start: s, end: e, atomic: false });
      from = to;
    }
  }
  return pieces;
}

/** Chunk ONE location's text. Call once per page/slide/section so chunks never cross locations. */
export function chunkLocation(text: string, options: ChunkOptions = {}): Chunk[] {
  const { targetTokens, maxTokens, overlapTokens } = { ...DEFAULTS, ...options };
  const blocks = splitBlocks(text).flatMap((b) => splitLong(b, maxTokens));
  const chunks: Chunk[] = [];
  let current: Block[] = [];

  const flush = () => {
    if (current.length === 0) return;
    const first = current[0] as Block;
    const last = current[current.length - 1] as Block;
    const body = text.slice(first.start, last.end);
    chunks.push({ ordinal: chunks.length, text: body, charStart: first.start, charEnd: last.end, tokenCount: estimateTokens(body) });
  };

  for (const block of blocks) {
    const tokens = estimateTokens(block.text);
    const currentTokens = current.length ? estimateTokens(text.slice((current[0] as Block).start, (current[current.length - 1] as Block).end)) : 0;
    if (current.length > 0 && (currentTokens + tokens > maxTokens || currentTokens >= targetTokens)) {
      flush();
      // Overlap: carry trailing non-atomic blocks (up to overlapTokens) into the next chunk.
      const carry: Block[] = [];
      let carried = 0;
      for (let i = current.length - 1; i >= 0; i -= 1) {
        const b = current[i] as Block;
        const t = estimateTokens(b.text);
        if (b.atomic || carried + t > overlapTokens) break;
        carry.unshift(b);
        carried += t;
      }
      current = carry.length && carried + tokens <= maxTokens ? carry : [];
    }
    current.push(block);
  }
  flush();
  return chunks;
}
