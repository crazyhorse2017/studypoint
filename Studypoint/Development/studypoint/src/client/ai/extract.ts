// Turning each kind of material into located text, in the browser (step 5, A24, LIB-03/04). PDFs give
// their text layer per page; pages with little real text (scans, handwriting) and photos are read by the
// OCR model. Word, PowerPoint, Markdown, web pages and notes are read from their structure, so each
// passage knows where it came from ("p. 12", "Slide 4", a heading).

import { unzipSync } from 'fflate';
import { classifyPageText } from '../../shared/ocrClassify.ts';
import { parseDocx, parsePptx } from '../reader/ooxml.ts';
import { ocrImage } from './aiApi.ts';
import { decryptText, encryptText } from '../../shared/crypto/vault.ts';
import { currentDataKey } from '../vault/vaultStore.ts';

export type Unit = { loc: string; page: number | null; text: string; ocr: boolean };
export type Progress = (msg: string) => void;

/** At most this many pages per file go to OCR, so one scan can't use up the day's AI allowance. */
export const MAX_OCR_PAGES = 40;

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** Downscale an image (≤ 1600 px on the long side) to JPEG for OCR. */
async function imageForOcr(source: CanvasImageSource & { width: number; height: number }): Promise<string> {
  const scale = Math.min(1, 1600 / Math.max(source.width, source.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(source.width * scale);
  canvas.height = Math.round(source.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser can’t prepare images.');
  ctx.fillStyle = 'white'; // transparent PNGs read better for OCR on white
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
  if (!blob) throw new Error('The image couldn’t be prepared.');
  return blobToDataUrl(blob);
}

// ---------------------------------------------------------------- OCR, resumable --
// Processing runs in this tab, and OCR takes ~10 s a page. So each page's OCR text is remembered for the
// rest of the tab session (ENCRYPTED with your data key, in sessionStorage, gone when the tab closes): if
// the page is reloaded mid-way, processing picks up where it stopped instead of reading every page again.

const OCR_PARALLEL = 3;
const ocrItem = (cacheKey: string, part: string) => `sf.ocr.${cacheKey}.${part}`;

async function cachedOcr(cacheKey: string, part: string, image: () => Promise<string>): Promise<string> {
  const k = currentDataKey();
  const item = ocrItem(cacheKey, part);
  const aad = `ocr:${cacheKey}:${part}`;
  if (k) {
    const saved = sessionStorage.getItem(item);
    if (saved) {
      try {
        return await decryptText(k, saved, aad);
      } catch {
        sessionStorage.removeItem(item);
      }
    }
  }
  const text = (await ocrImage(await image())).trim();
  if (k) {
    try {
      sessionStorage.setItem(item, await encryptText(k, text, aad));
    } catch {
      // storage full: fine, it just won't resume
    }
  }
  return text;
}

/** Run `fn` over items with at most `limit` running at once, keeping results in order. */
async function inParallel<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      out[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function pdfUnits(bytes: Uint8Array, progress: Progress, cacheKey: string): Promise<Unit[]> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  const task = pdfjs.getDocument({ data: bytes.slice() });
  const doc = await task.promise;
  try {
    // 1. The text layer of every page (fast, no AI).
    const texts: string[] = [];
    for (let n = 1; n <= doc.numPages; n += 1) {
      progress(`Reading page ${n} of ${doc.numPages}`);
      const content = await (await doc.getPage(n)).getTextContent();
      let text = '';
      for (const item of content.items) if ('str' in item) text += item.str + (item.hasEOL ? '\n' : ' ');
      texts.push(text.replace(/[ \t]+\n/g, '\n').trim());
    }
    // 2. OCR only the pages that need it, 3 at a time, resuming from this tab's cache.
    const needOcr = texts.map((t, i) => (classifyPageText(t).needsOcr ? i + 1 : 0)).filter((n) => n > 0).slice(0, MAX_OCR_PAGES);
    let done = 0;
    const ocrTexts = await inParallel(needOcr, OCR_PARALLEL, async (n) => {
      const text = await cachedOcr(cacheKey, `p${n}`, async () => {
        const page = await doc.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(2.5, 1600 / Math.max(base.width, base.height)) });
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        await page.render({ canvas, viewport }).promise;
        return imageForOcr(canvas);
      }).catch(() => '');
      done += 1;
      progress(`Reading scanned pages with OCR: ${done} of ${needOcr.length}`);
      return text;
    });
    const ocrByPage = new Map(needOcr.map((n, i) => [n, ocrTexts[i] ?? '']));
    const units: Unit[] = [];
    texts.forEach((text, i) => {
      const n = i + 1;
      const ocr = ocrByPage.get(n);
      if (ocr && ocr.length > text.length) units.push({ loc: `p. ${n}`, page: n, text: ocr, ocr: true });
      else if (text) units.push({ loc: `p. ${n}`, page: n, text, ocr: false });
    });
    return units;
  } finally {
    void task.destroy();
  }
}

async function photoUnits(bytes: Uint8Array, mime: string, cacheKey: string): Promise<Unit[]> {
  const text = await cachedOcr(cacheKey, 'photo', async () => {
    const bitmap = await createImageBitmap(new Blob([bytes.slice().buffer as ArrayBuffer], { type: mime }));
    try {
      return await imageForOcr(bitmap);
    } finally {
      bitmap.close();
    }
  });
  return text ? [{ loc: 'Photo', page: null, text, ocr: true }] : [];
}

/** Split Markdown (and web pages saved as Markdown) into sections by heading. */
export function markdownUnits(md: string): Unit[] {
  const units: Unit[] = [];
  let heading = 'Start';
  let buf: string[] = [];
  const flush = () => {
    const text = buf.join('\n').trim();
    if (text) units.push({ loc: heading, page: null, text, ocr: false });
    buf = [];
  };
  for (const line of md.split('\n')) {
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      heading = (h[2] ?? '').trim().slice(0, 80) || heading;
      buf.push(line);
    } else buf.push(line);
  }
  flush();
  return units;
}

function docxUnits(bytes: Uint8Array): Unit[] {
  const blocks = parseDocx(unzipSync(bytes));
  const units: Unit[] = [];
  let heading = 'Document';
  let buf: string[] = [];
  const flush = () => {
    if (buf.join('').trim()) units.push({ loc: heading, page: null, text: buf.join('\n').trim(), ocr: false });
    buf = [];
  };
  for (const b of blocks) {
    if (b.type === 'heading') {
      flush();
      heading = b.runs.map((r) => r.text).join('').trim().slice(0, 80) || heading;
      buf.push(heading);
    } else if (b.type === 'para' || b.type === 'item') buf.push((b.type === 'item' ? '• ' : '') + b.runs.map((r) => r.text).join(''));
    else if (b.type === 'table') buf.push(b.rows.map((row) => row.map((c) => c.map((r) => r.text).join('')).join(' | ')).join('\n'));
  }
  flush();
  return units;
}

function pptxUnits(bytes: Uint8Array): Unit[] {
  return parsePptx(unzipSync(bytes))
    .map((s) => ({
      loc: `Slide ${s.number}`,
      page: s.number,
      text: [s.title, ...s.lines.map((l) => `${'  '.repeat(l.level)}• ${l.text}`), ...(s.notes.length ? ['Notes:', ...s.notes] : [])].filter(Boolean).join('\n'),
      ocr: false,
    }))
    .filter((u) => u.text.trim());
}

/** `cacheKey` identifies this exact version of the file (its version id), for resuming OCR. */
export async function fileUnits(kind: string, mime: string, bytes: Uint8Array, progress: Progress, cacheKey: string): Promise<Unit[]> {
  if (kind === 'pdf') return pdfUnits(bytes, progress, cacheKey);
  if (kind === 'image') {
    progress('Reading the photo with OCR');
    return photoUnits(bytes, mime, cacheKey);
  }
  if (kind === 'docx') return docxUnits(bytes);
  if (kind === 'pptx') return pptxUnits(bytes);
  if (kind === 'md') return markdownUnits(new TextDecoder().decode(bytes));
  return [];
}

type TipNode = { type?: string; text?: string; attrs?: Record<string, unknown>; content?: TipNode[] };

/** A note's editor document → sections by heading (math kept as its LaTeX). */
export function noteUnits(doc: TipNode): Unit[] {
  const lines: string[] = [];
  const inline = (n: TipNode): string => {
    if (n.type === 'text') return n.text ?? '';
    if (n.type === 'inlineMath' || n.type === 'blockMath') return ` ${String(n.attrs?.['latex'] ?? '')} `;
    if (n.type === 'hardBreak') return '\n';
    return (n.content ?? []).map(inline).join('');
  };
  const block = (n: TipNode, prefix = '') => {
    if (n.type === 'heading') lines.push(`${'#'.repeat(Number(n.attrs?.['level'] ?? 2))} ${inline(n)}`);
    else if (n.type === 'paragraph' || n.type === 'codeBlock' || n.type === 'blockMath') lines.push(prefix + inline(n));
    else if (n.type === 'listItem') (n.content ?? []).forEach((c) => block(c, '• '));
    else (n.content ?? []).forEach((c) => block(c, prefix));
  };
  block(doc);
  return markdownUnits(lines.join('\n'));
}
