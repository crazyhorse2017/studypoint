// PDF pages (step 3 Reader, LIB-06) with pdf.js. Pages render only as they scroll into view, at the
// screen's pixel density, with an invisible text layer on top so text can be selected, copied, found
// with Ctrl+F and read by screen readers. The current page is kept in the URL (?page=N), so a reload or a
// link opens the same page.

import { useCallback, useEffect, useRef, useState } from 'react';
import { GlobalWorkerOptions, TextLayer, getDocument, type PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { Button, TextField } from '../ds/index.ts';

GlobalWorkerOptions.workerSrc = workerUrl;

const ZOOMS: readonly number[] = [0.75, 1, 1.25, 1.5, 2];
const MIN_ZOOM = 0.75;
const MAX_ZOOM = 2;
const stepZoom = (z: number, dir: 1 | -1) => ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, ZOOMS.indexOf(z) + dir))] ?? 1;

function Page({ doc, n, width, onVisible }: { doc: PDFDocumentProxy; n: number; width: number; onVisible: (n: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [aspect, setAspect] = useState(1.294); // A4/Letter until the real size is known

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setNear(true);
          if (e.intersectionRatio > 0.5) onVisible(n);
        }
      },
      { rootMargin: '800px 0px', threshold: [0, 0.5] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [n, onVisible]);

  useEffect(() => {
    if (!near || width <= 0) return;
    let cancelled = false;
    let task: { cancel: () => void } | null = null;
    let text: TextLayer | null = null;
    void (async () => {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      if (cancelled) return;
      setAspect(base.height / base.width);
      const viewport = page.getViewport({ scale: width / base.width });
      const dpr = window.devicePixelRatio || 1;
      const host = box.current;
      if (!host) return;
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      canvas.setAttribute('aria-hidden', 'true');
      const layer = document.createElement('div');
      layer.className = 'textLayer';
      // pdf.js sizes and positions the text layer from these CSS variables.
      host.style.setProperty('--scale-factor', String(viewport.scale));
      host.style.setProperty('--total-scale-factor', String(viewport.scale));
      host.style.setProperty('--user-unit', '1');
      host.replaceChildren(canvas, layer);
      const render = page.render({ canvas, viewport, transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0] });
      task = render;
      await render.promise.catch(() => undefined);
      if (cancelled) return;
      text = new TextLayer({ textContentSource: page.streamTextContent(), container: layer, viewport });
      await text.render().catch(() => undefined);
    })();
    return () => {
      cancelled = true;
      task?.cancel();
      text?.cancel();
    };
  }, [doc, n, near, width]);

  return (
    <div
      ref={box}
      role="region"
      aria-label={`Page ${n}`}
      data-page={n}
      className="pdf-page relative mx-auto bg-surface shadow-pop"
      style={{ width, height: width * aspect }}
    />
  );
}

export function PdfView({ bytes, initialPage }: { bytes: Uint8Array; initialPage: number }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number>(1);
  const [page, setPage] = useState(initialPage);
  const [jump, setJump] = useState(String(initialPage));
  const wrap = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(0);
  const scrolled = useRef(false);

  useEffect(() => {
    // pdf.js takes ownership of the buffer it's given, so hand it a copy.
    const task = getDocument({ data: bytes.slice() });
    task.promise.then(setDoc, () => setError('This PDF couldn’t be opened. It may be damaged or password-protected.'));
    return () => void task.destroy();
  }, [bytes]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setFit(Math.min(el.clientWidth, 900)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const goTo = (n: number) => {
    if (!doc) return;
    const target = Math.min(Math.max(1, n), doc.numPages);
    wrap.current?.querySelector(`[data-page="${target}"]`)?.scrollIntoView({ block: 'start' });
  };

  // Open at ?page=N once the pages exist.
  useEffect(() => {
    if (!doc || scrolled.current || fit === 0) return;
    scrolled.current = true;
    if (initialPage > 1) requestAnimationFrame(() => goTo(initialPage));
  });

  // Stable identity, so each page's IntersectionObserver isn't recreated on every render.
  const onVisible = useCallback((n: number) => {
    setPage(n);
    setJump(String(n));
    const url = new URL(window.location.href);
    url.searchParams.set('page', String(n));
    window.history.replaceState(null, '', url.pathname + url.search);
  }, []);

  if (error) return <p className="text-danger">{error}</p>;
  const width = Math.round(fit * zoom);

  return (
    <div className="flex flex-col gap-4">
      <div role="toolbar" aria-label="PDF controls" className="sticky top-14 z-10 flex flex-wrap items-end gap-2 border-b border-border bg-page/95 py-2 backdrop-blur-sm">
        <Button size="sm" variant="ghost" disabled={!doc || page <= 1} onClick={() => goTo(page - 1)}>
          ← Previous
        </Button>
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            goTo(Number(jump) || 1);
          }}
        >
          <div className="w-20">
            <TextField label="Page" inputMode="numeric" value={jump} onChange={(e) => setJump(e.target.value.replace(/\D/g, ''))} />
          </div>
          <span className="pb-2 text-sm text-text-2">of {doc?.numPages ?? '…'}</span>
        </form>
        <Button size="sm" variant="ghost" disabled={!doc || page >= (doc?.numPages ?? 1)} onClick={() => goTo(page + 1)}>
          Next →
        </Button>
        <span className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="ghost" aria-label="Zoom out" disabled={zoom <= MIN_ZOOM} onClick={() => setZoom(stepZoom(zoom, -1))}>
            −
          </Button>
          <span className="w-14 text-center text-sm text-text-2" aria-live="polite">{Math.round(zoom * 100)}%</span>
          <Button size="sm" variant="ghost" aria-label="Zoom in" disabled={zoom >= MAX_ZOOM} onClick={() => setZoom(stepZoom(zoom, 1))}>
            +
          </Button>
        </span>
      </div>
      <div ref={wrap} className="flex flex-col gap-4 overflow-x-auto pb-8">
        {!doc ? <p className="text-text-2">Preparing pages…</p> : null}
        {doc && width > 0 ? Array.from({ length: doc.numPages }, (_, i) => <Page key={i + 1} doc={doc} n={i + 1} width={width} onVisible={onVisible} />) : null}
      </div>
    </div>
  );
}
