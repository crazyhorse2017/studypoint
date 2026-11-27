// Images for image-occlusion cards (CRD-01): an uploaded photo, or one page of an uploaded PDF rendered to
// an image. Decrypted in the browser and cached for this session, so a review session doesn't download
// the same file for every card.

import { fetchFile, openFile } from '../files/filesApi.ts';

const cache = new Map<string, Promise<string>>();

async function render(fileId: string, page: number | null): Promise<string> {
  const f = await fetchFile(fileId);
  const bytes = await openFile(f);
  if (f.kind === 'image') return URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type: f.mime }));
  if (f.kind !== 'pdf') throw new Error('Image occlusion works with photos and PDF pages.');
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const task = pdfjs.getDocument({ data: bytes.slice() });
  const doc = await task.promise;
  try {
    const p = await doc.getPage(Math.min(Math.max(1, page ?? 1), doc.numPages));
    const base = p.getViewport({ scale: 1 });
    const viewport = p.getViewport({ scale: Math.min(3, 1600 / base.width) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await p.render({ canvas, viewport }).promise;
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', 0.9));
    if (!blob) throw new Error('That page couldn’t be drawn.');
    return URL.createObjectURL(blob);
  } finally {
    void task.destroy();
  }
}

/** An object URL for the image behind an occlusion card (cached for the session). */
export function occlusionImageUrl(fileId: string, page: number | null): Promise<string> {
  const key = `${fileId}#${page ?? 0}`;
  let p = cache.get(key);
  if (!p) {
    p = render(fileId, page);
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }
  return p;
}

/** PDF page count, for the page picker when making a card. */
export async function pdfPageCount(fileId: string): Promise<number> {
  const f = await fetchFile(fileId);
  if (f.kind !== 'pdf') return 1;
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  const task = pdfjs.getDocument({ data: (await openFile(f)).slice() });
  const n = (await task.promise).numPages;
  void task.destroy();
  return n;
}
