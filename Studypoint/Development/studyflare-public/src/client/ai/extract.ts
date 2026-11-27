// Turning each kind of material into located text, in the browser (step 5, A24, LIB-03/04). PDFs give
// their text layer per page; pages with little real text (scans, handwriting) and photos are read by the
// OCR model. Word, PowerPoint, Markdown, web pages and notes are read from their structure, so each
// passage knows where it came from ("p. 12", "Slide 4", a heading).

import { unzipSync } from 'fflate';
import { classifyPageText } from '../../shared/ocrClassify.ts';
import { parseDocx, parsePptx } from '../reader/ooxml.ts';
import { ocrImage } from './aiApi.ts';

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

async function pdfUnits(bytes: Uint8Array, progress: Progress): Promise<Unit[]> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  const task = pdfjs.getDocument({ data: bytes.slice() });
  const doc = await task.promise;
  const units: Unit[] = [];
  let ocrUsed = 0;
  try {
    for (let n = 1; n <= doc.numPages; n += 1) {
      progress(`Reading page ${n} of ${doc.numPages}`);
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) {
        if ('str' in item) text += item.str + (item.hasEOL ? '\n' : ' ');
      }
      text = text.replace(/[ \t]+\n/g, '\n').trim();
      if (classifyPageText(text).needsOcr && ocrUsed < MAX_OCR_PAGES) {
        ocrUsed += 1;
        progress(`Reading page ${n} with OCR`);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(2.5, 1600 / Math.max(base.width, base.height)) });
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        await page.render({ canvas, viewport }).promise;
        const ocrText = await ocrImage(await imageForOcr(canvas)).catch(() => '');
        if (ocrText.trim().length > text.length) {
          units.push({ loc: `p. ${n}`, page: n, text: ocrText.trim(), ocr: true });
          continue;
        }
      }
      if (text) units.push({ loc: `p. ${n}`, page: n, text, ocr: false });
    }
  } finally {
    void task.destroy();
  }
  return units;
}

async function photoUnits(bytes: Uint8Array, mime: string): Promise<Unit[]> {
  const bitmap = await createImageBitmap(new Blob([bytes.slice().buffer as ArrayBuffer], { type: mime }));
  const text = await ocrImage(await imageForOcr(bitmap));
  bitmap.close();
  return text.trim() ? [{ loc: 'Photo', page: null, text: text.trim(), ocr: true }] : [];
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

export async function fileUnits(kind: string, mime: string, bytes: Uint8Array, progress: Progress): Promise<Unit[]> {
  if (kind === 'pdf') return pdfUnits(bytes, progress);
  if (kind === 'image') {
    progress('Reading the photo with OCR');
    return photoUnits(bytes, mime);
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
