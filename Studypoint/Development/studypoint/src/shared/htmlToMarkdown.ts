// Readable text from a web page (link import, LKP-02-lite). Pure: takes a stream of open/close/text events
// (the Worker produces them with HTMLRewriter; tests feed them by hand) and builds Markdown of the
// readable content only: headings, paragraphs, lists, quotes, code and tables. Navigation, scripts,
// styles, forms, headers, footers and asides are dropped. If the page has <main> or <article> with real
// text, only that part is kept.

export type HtmlEvent = { kind: 'open'; tag: string; attrs?: Record<string, string> } | { kind: 'close'; tag: string } | { kind: 'text'; text: string };

const SKIP = new Set(['script', 'style', 'noscript', 'nav', 'footer', 'header', 'aside', 'form', 'svg', 'iframe', 'button', 'select', 'template', 'canvas', 'dialog', 'menu']);
const BLOCK = new Set(['p', 'div', 'section', 'article', 'main', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'tr', 'table', 'ul', 'ol', 'dl', 'dt', 'dd', 'figure', 'figcaption', 'br', 'hr']);

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’',
  ldquo: '“', rdquo: '”', deg: '°', times: '×', divide: '÷', plusmn: '±', le: '≤', ge: '≥', ne: '≠', copy: '©', reg: '®',
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', theta: 'θ', lambda: 'λ', mu: 'μ', pi: 'π', sigma: 'σ', omega: 'ω', middot: '·', bull: '•',
};

/** Decode HTML character references (HTMLRewriter hands over raw text). */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, ref: string) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return NAMED[ref.toLowerCase()] ?? m;
  });
}

type Line = { prefix: string; text: string; pre?: boolean };

class Builder {
  lines: Line[] = [];
  cur: Line = { prefix: '', text: '' };
  flush() {
    const t = this.cur.pre ? this.cur.text : this.cur.text.replace(/[ \t\r\n]+/g, ' ').trim();
    if (t) this.lines.push({ ...this.cur, text: t });
    this.cur = { prefix: '', text: '' };
  }
  toString() {
    this.flush();
    const out: string[] = [];
    for (const l of this.lines) {
      if (l.pre) out.push('```\n' + l.text.replace(/\n+$/, '') + '\n```');
      else out.push(l.prefix + l.text);
    }
    // Blank lines between blocks, but keep consecutive list items and table rows together.
    return out.reduce((acc, line, i) => {
      if (i === 0) return line;
      const prev = out[i - 1] ?? '';
      const tight = (/^(\s*[-*] |\s*\d+\. )/.test(line) && /^(\s*[-*] |\s*\d+\. )/.test(prev)) || (line.startsWith('|') && prev.startsWith('|'));
      return acc + (tight ? '\n' : '\n\n') + line;
    }, '');
  }
}

export type Extracted = { title: string; markdown: string };

export function eventsToMarkdown(events: Iterable<HtmlEvent>): Extracted {
  const all = new Builder();
  const main = new Builder();
  let skip = 0;
  let inMain = 0;
  let inTitle = false;
  let title = '';
  let pre = 0;
  const lists: Array<{ ordered: boolean; n: number }> = [];
  let cellCount = 0;

  const each = (fn: (b: Builder) => void) => {
    fn(all);
    if (inMain > 0) fn(main);
  };

  for (const e of events) {
    if (e.kind === 'open') {
      const tag = e.tag.toLowerCase();
      if (tag === 'title') inTitle = true;
      if (SKIP.has(tag)) skip += 1;
      if (skip > 0) continue;
      if (tag === 'main' || tag === 'article') inMain += 1;
      if (BLOCK.has(tag)) each((b) => b.flush());
      if (/^h[1-6]$/.test(tag)) each((b) => (b.cur.prefix = '#'.repeat(Number(tag[1])) + ' '));
      else if (tag === 'ul' || tag === 'ol') lists.push({ ordered: tag === 'ol', n: 0 });
      else if (tag === 'li') {
        const l = lists[lists.length - 1];
        const indent = '  '.repeat(Math.max(0, lists.length - 1));
        if (l) l.n += 1;
        each((b) => (b.cur.prefix = indent + (l?.ordered ? `${l.n}. ` : '- ')));
      } else if (tag === 'blockquote') each((b) => (b.cur.prefix = '> '));
      else if (tag === 'pre') {
        pre += 1;
        each((b) => (b.cur.pre = true));
      } else if (tag === 'tr') {
        cellCount = 0;
        each((b) => (b.cur.prefix = '| '));
      } else if (tag === 'td' || tag === 'th') {
        if (cellCount > 0) each((b) => (b.cur.text += ' | '));
        cellCount += 1;
      } else if (tag === 'strong' || tag === 'b') each((b) => (b.cur.text += '**'));
      else if (tag === 'em' || tag === 'i') each((b) => (b.cur.text += '*'));
      else if (tag === 'code' && pre === 0) each((b) => (b.cur.text += '`'));
      else if (tag === 'hr') each((b) => b.lines.push({ prefix: '', text: '---' }));
      else if (tag === 'img' && e.attrs?.['alt']) each((b) => (b.cur.text += ` [image: ${e.attrs?.['alt'] ?? ''}] `));
    } else if (e.kind === 'close') {
      const tag = e.tag.toLowerCase();
      if (tag === 'title') inTitle = false;
      if (SKIP.has(tag)) {
        skip = Math.max(0, skip - 1);
        continue;
      }
      if (skip > 0) continue;
      if (tag === 'strong' || tag === 'b') each((b) => (b.cur.text += '**'));
      else if (tag === 'em' || tag === 'i') each((b) => (b.cur.text += '*'));
      else if (tag === 'code' && pre === 0) each((b) => (b.cur.text += '`'));
      else if (tag === 'tr') each((b) => (b.cur.text += ' |'));
      if (tag === 'ul' || tag === 'ol') lists.pop();
      if (tag === 'pre') pre = Math.max(0, pre - 1);
      if (BLOCK.has(tag)) each((b) => b.flush());
      if (tag === 'main' || tag === 'article') inMain = Math.max(0, inMain - 1);
    } else {
      const text = decodeEntities(e.text);
      if (inTitle) title += text;
      if (skip > 0 || inTitle) continue;
      each((b) => (b.cur.text += text));
    }
  }
  const mainText = main.toString();
  const markdown = mainText.replace(/\s/g, '').length >= 400 ? mainText : all.toString();
  return { title: title.replace(/\s+/g, ' ').trim(), markdown: markdown.replace(/\*\*\s*\*\*/g, '').replace(/\n{3,}/g, '\n\n').trim() };
}
