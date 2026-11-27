// A small, safe Markdown reader for imported web pages and .md files (Reader, step 3/4). Pure: turns
// Markdown into blocks and inline pieces that React renders itself, so no HTML is ever injected. Covers
// what imported pages produce: headings, paragraphs, lists (with nesting), quotes, code, rules, simple
// tables, **bold**, *italic*, `code` and [links](https://…) (http/https/mailto only).

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string };

export type MdBlock =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; inline: Inline[] }
  | { type: 'para'; inline: Inline[] }
  | { type: 'list'; ordered: boolean; items: Array<{ level: number; inline: Inline[] }> }
  | { type: 'quote'; inline: Inline[] }
  | { type: 'code'; text: string; lang: string }
  | { type: 'table'; rows: Inline[][][] }
  | { type: 'rule' };

const SAFE_HREF = /^(https?:\/\/|mailto:)/i;

export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (const m of s.matchAll(re)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ kind: 'text', text: s.slice(last, at) });
    if (m[1] !== undefined) out.push({ kind: 'bold', text: m[1] });
    else if (m[2] !== undefined) out.push({ kind: 'italic', text: m[2] });
    else if (m[3] !== undefined) out.push({ kind: 'code', text: m[3] });
    else if (m[4] !== undefined) out.push(SAFE_HREF.test(m[5] ?? '') ? { kind: 'link', text: m[4], href: m[5] as string } : { kind: 'text', text: m[4] });
    last = at + m[0].length;
  }
  if (last < s.length) out.push({ kind: 'text', text: s.slice(last) });
  return out;
}

const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

export function parseMarkdown(md: string): MdBlock[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const blocks: MdBlock[] = [];
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push({ type: 'para', inline: parseInline(para.join(' ').trim()) });
    para = [];
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (/^```/.test(line.trim())) {
      flushPara();
      const lang = line.trim().slice(3).trim().toLowerCase();
      const code: string[] = [];
      for (i += 1; i < lines.length && !/^```/.test((lines[i] ?? '').trim()); i += 1) code.push(lines[i] ?? '');
      blocks.push({ type: 'code', text: code.join('\n'), lang });
      continue;
    }
    if (!line.trim()) {
      flushPara();
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      blocks.push({ type: 'heading', level: (h[1] as string).length as 1 | 2 | 3 | 4 | 5 | 6, inline: parseInline((h[2] ?? '').trim()) });
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      flushPara();
      blocks.push({ type: 'rule' });
      continue;
    }
    if (line.startsWith('>')) {
      flushPara();
      const q: string[] = [];
      for (; i < lines.length && (lines[i] ?? '').startsWith('>'); i += 1) q.push((lines[i] ?? '').replace(/^>\s?/, ''));
      i -= 1;
      blocks.push({ type: 'quote', inline: parseInline(q.join(' ')) });
      continue;
    }
    if (line.trim().startsWith('|')) {
      flushPara();
      const rows: Inline[][][] = [];
      for (; i < lines.length && (lines[i] ?? '').trim().startsWith('|'); i += 1) {
        const cells = (lines[i] ?? '').trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells.map(parseInline));
      }
      i -= 1;
      blocks.push({ type: 'table', rows });
      continue;
    }
    const li = LIST.exec(line);
    if (li) {
      flushPara();
      const ordered = /\d/.test(li[2] ?? '');
      const items: Array<{ level: number; inline: Inline[] }> = [];
      for (; i < lines.length; i += 1) {
        const m = LIST.exec(lines[i] ?? '');
        if (!m || /\d/.test(m[2] ?? '') !== ordered) break;
        items.push({ level: Math.floor((m[1] ?? '').replace(/\t/g, '  ').length / 2), inline: parseInline(m[3] ?? '') });
      }
      i -= 1;
      blocks.push({ type: 'list', ordered, items });
      continue;
    }
    para.push(line.trim());
  }
  flushPara();
  return blocks;
}
