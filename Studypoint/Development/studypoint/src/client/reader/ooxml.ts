// Reading Word (.docx) and PowerPoint (.pptx) files in the browser (step 3 Reader, LIB-06). Both are ZIPs
// of XML. This turns that XML into a small, neutral structure the Reader renders with React itself, so
// no HTML from a file is ever injected into the page. Unzipping happens in ReaderPage (fflate); these
// functions take the unzipped entries, which keeps them testable with hand-made XML.

export type Entries = Readonly<Record<string, Uint8Array>>;

export type Run = { text: string; bold?: boolean; italic?: boolean; underline?: boolean; sup?: boolean; sub?: boolean };
export type Block =
  | { type: 'heading'; level: 1 | 2 | 3; runs: Run[] }
  | { type: 'para'; runs: Run[] }
  | { type: 'item'; ordered: boolean; level: number; runs: Run[] }
  | { type: 'table'; rows: Run[][][] }
  | { type: 'image'; path: string }
  | { type: 'equation' };

export type Slide = { number: number; title: string; lines: Array<{ text: string; level: number }>; images: string[]; notes: string[] };

const text = (bytes: Uint8Array | undefined) => (bytes ? new TextDecoder().decode(bytes) : '');
const parse = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml');
const kids = (el: Element) => Array.from(el.children);
const child = (el: Element | null | undefined, name: string) => (el ? kids(el).find((c) => c.localName === name) ?? null : null);
const descendants = (el: Element, name: string) => Array.from(el.getElementsByTagName('*')).filter((e) => e.localName === name);
/** Attribute by local name, whatever its namespace prefix (w:val, r:embed, r:id …). */
const attr = (el: Element | null | undefined, name: string) => {
  if (!el) return null;
  for (const a of Array.from(el.attributes)) if (a.localName === name) return a.value;
  return null;
};

/** A relationship reference (r:id, r:embed): the attribute in the relationships namespace specifically. */
const relAttr = (el: Element | null | undefined, name: string) => {
  if (!el) return null;
  for (const a of Array.from(el.attributes)) if (a.localName === name && (a.namespaceURI ?? '').endsWith('/relationships')) return a.value;
  return null;
};

/** Resolve a relationship target against the folder of the part that refers to it. */
export function resolvePath(fromPart: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = fromPart.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.' && seg !== '') parts.push(seg);
  }
  return parts.join('/');
}

/** Relationship id → { target path, type } for one part (e.g. word/document.xml). */
export function relationships(entries: Entries, part: string): Map<string, { path: string; type: string }> {
  const slash = part.lastIndexOf('/');
  const relsPath = `${part.slice(0, slash)}/_rels/${part.slice(slash + 1)}.rels`;
  const map = new Map<string, { path: string; type: string }>();
  const doc = entries[relsPath];
  if (!doc) return map;
  for (const r of Array.from(parse(text(doc)).getElementsByTagName('*')).filter((e) => e.localName === 'Relationship')) {
    const id = attr(r, 'Id');
    const target = attr(r, 'Target');
    if (id && target && attr(r, 'TargetMode') !== 'External') map.set(id, { path: resolvePath(part, target), type: attr(r, 'Type') ?? '' });
  }
  return map;
}

// ---------------------------------------------------------------- Word --

function wordRuns(p: Element, rels: Map<string, { path: string; type: string }>, images: string[]): Run[] {
  const runs: Run[] = [];
  const visit = (el: Element) => {
    for (const c of kids(el)) {
      if (c.localName === 'r') {
        const pr = child(c, 'rPr');
        const on = (name: string) => {
          const e = child(pr, name);
          return e !== null && attr(e, 'val') !== '0' && attr(e, 'val') !== 'false' && attr(e, 'val') !== 'none';
        };
        const va = attr(child(pr, 'vertAlign'), 'val');
        let t = '';
        for (const x of kids(c)) {
          if (x.localName === 't') t += x.textContent ?? '';
          else if (x.localName === 'tab') t += '\t';
          else if (x.localName === 'br' || x.localName === 'cr') t += '\n';
          else if (x.localName === 'drawing' || x.localName === 'pict') {
            for (const blip of descendants(x, 'blip')) {
              const rel = rels.get(relAttr(blip, 'embed') ?? '');
              if (rel) images.push(rel.path);
            }
          }
        }
        if (t) runs.push({ text: t, bold: on('b') || undefined, italic: on('i') || undefined, underline: on('u') || undefined, sup: va === 'superscript' || undefined, sub: va === 'subscript' || undefined });
      } else if (c.localName === 'hyperlink' || c.localName === 'smartTag' || c.localName === 'ins' || c.localName === 'sdtContent' || c.localName === 'sdt') {
        visit(c);
      } else if (c.localName === 'oMath' || c.localName === 'oMathPara') {
        runs.push({ text: '⟨equation⟩', italic: true });
      }
    }
  };
  visit(p);
  return runs;
}

/** numId → whether that list is numbered (decimal, letters, roman) rather than bulleted. */
function numberedLists(entries: Entries): Map<string, boolean> {
  const out = new Map<string, boolean>();
  const xml = entries['word/numbering.xml'];
  if (!xml) return out;
  const doc = parse(text(xml));
  const abstract = new Map<string, boolean>();
  for (const a of descendants(doc.documentElement, 'abstractNum')) {
    const lvl0 = kids(a).find((k) => k.localName === 'lvl');
    abstract.set(attr(a, 'abstractNumId') ?? '', attr(child(lvl0, 'numFmt'), 'val') !== 'bullet');
  }
  for (const n of descendants(doc.documentElement, 'num')) {
    out.set(attr(n, 'numId') ?? '', abstract.get(attr(child(n, 'abstractNumId'), 'val') ?? '') ?? false);
  }
  return out;
}

export function parseDocx(entries: Entries): Block[] {
  const part = 'word/document.xml';
  const xml = entries[part];
  if (!xml) throw new Error('This Word file has no document inside.');
  const body = child(parse(text(xml)).documentElement, 'body');
  if (!body) return [];
  const rels = relationships(entries, part);
  const numbered = numberedLists(entries);
  const blocks: Block[] = [];

  const paragraph = (p: Element) => {
    const images: string[] = [];
    const pPr = child(p, 'pPr');
    const style = (attr(child(pPr, 'pStyle'), 'val') ?? '').toLowerCase();
    const runs = wordRuns(p, rels, images);
    const numPr = child(pPr, 'numPr');
    if (runs.some((r) => r.text.trim() !== '')) {
      const h = /^(heading|title)(\d?)$/.exec(style.replace(/\s/g, ''));
      if (h) blocks.push({ type: 'heading', level: h[1] === 'title' ? 1 : (Math.min(3, Math.max(1, Number(h[2] || 1))) as 1 | 2 | 3), runs });
      else if (numPr) blocks.push({ type: 'item', ordered: numbered.get(attr(child(numPr, 'numId'), 'val') ?? '') ?? false, level: Number(attr(child(numPr, 'ilvl'), 'val') ?? 0), runs });
      else blocks.push({ type: 'para', runs });
    }
    for (const path of images) blocks.push({ type: 'image', path });
  };

  for (const el of kids(body)) {
    if (el.localName === 'p') paragraph(el);
    else if (el.localName === 'tbl') {
      const rows: Run[][][] = [];
      for (const tr of kids(el).filter((k) => k.localName === 'tr')) {
        rows.push(kids(tr).filter((k) => k.localName === 'tc').map((tc) => kids(tc).filter((k) => k.localName === 'p').flatMap((p, i) => {
          const r = wordRuns(p, rels, []);
          return i > 0 && r.length ? [{ text: '\n' }, ...r] : r;
        })));
      }
      if (rows.length) blocks.push({ type: 'table', rows });
    } else if (el.localName === 'sdt') {
      for (const p of descendants(el, 'p')) paragraph(p);
    }
  }
  return blocks;
}

// ---------------------------------------------------------------- PowerPoint --

function shapeParagraphs(sp: Element): Array<{ text: string; level: number }> {
  const out: Array<{ text: string; level: number }> = [];
  const body = child(sp, 'txBody');
  if (!body) return out;
  for (const p of kids(body).filter((k) => k.localName === 'p')) {
    const t = descendants(p, 't').map((x) => x.textContent ?? '').join('');
    if (t.trim()) out.push({ text: t, level: Number(attr(child(p, 'pPr'), 'lvl') ?? 0) });
  }
  return out;
}

const placeholderType = (sp: Element) => attr(child(child(child(sp, 'nvSpPr'), 'nvPr'), 'ph'), 'type');

export function parsePptx(entries: Entries): Slide[] {
  const presPart = 'ppt/presentation.xml';
  const pres = entries[presPart];
  if (!pres) throw new Error('This PowerPoint file has no presentation inside.');
  const presRels = relationships(entries, presPart);
  const order = descendants(parse(text(pres)).documentElement, 'sldId').map((s) => presRels.get(relAttr(s, 'id') ?? '')?.path).filter((p): p is string => !!p);

  return order.map((part, i) => {
    const slide: Slide = { number: i + 1, title: '', lines: [], images: [], notes: [] };
    const xml = entries[part];
    if (!xml) return slide;
    const rels = relationships(entries, part);
    const root = parse(text(xml)).documentElement;
    for (const sp of descendants(root, 'sp')) {
      const type = placeholderType(sp);
      const paras = shapeParagraphs(sp);
      if ((type === 'title' || type === 'ctrTitle') && !slide.title) slide.title = paras.map((p) => p.text).join(' ');
      else slide.lines.push(...paras);
    }
    for (const blip of descendants(root, 'blip')) {
      const rel = rels.get(relAttr(blip, 'embed') ?? '');
      if (rel && !slide.images.includes(rel.path)) slide.images.push(rel.path);
    }
    const notesRel = [...rels.values()].find((r) => r.type.endsWith('/notesSlide'));
    const notesXml = notesRel ? entries[notesRel.path] : undefined;
    if (notesXml) {
      for (const sp of descendants(parse(text(notesXml)).documentElement, 'sp')) {
        if (placeholderType(sp) === 'body') slide.notes.push(...shapeParagraphs(sp).map((p) => p.text));
      }
    }
    return slide;
  });
}

/** MIME type for an embedded image, or null for formats a browser can't show (EMF/WMF) or won't (SVG). */
export function imageMime(path: string): string | null {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp' } as Record<string, string>)[ext] ?? null;
}
