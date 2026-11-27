// A citation in an answer (step 6a, AST-02, LIB-09): a small chip that opens a preview of the passage it
// cites, with the quoted words highlighted (marked AND outlined, never colour alone). From there, "Open"
// goes to the file at that page with the quote highlighted. Hover or focus previews; click or Enter pins
// it open; Escape or clicking elsewhere closes it.

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { fileTarget, quoteWindow } from '../../shared/quoteSpans.ts';
import { Link } from '../Link.tsx';
import { MathText } from '../cards/MathText.tsx';
import { setPendingHighlight } from '../reader/highlight.ts';
import type { ChatSource } from './chatApi.ts';

export function CitationChip({ refId, quote, source }: { refId: string; quote: string; source: ChatSource }) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const panelId = useId();
  const label = `${source.title}${source.loc ? `, ${source.loc}` : ''}`;
  const win = useMemo(() => quoteWindow(source.text, quote, source.ocr), [source.text, quote, source.ocr]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) {
        setOpen(false);
        setPinned(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setPinned(false);
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const hoverOpen = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(true), 250);
  };
  const hoverClose = () => {
    window.clearTimeout(timer.current);
    if (!pinned) timer.current = window.setTimeout(() => setOpen(false), 200);
  };

  const target = source.external ? null : fileTarget(source.href);
  const openFile = () => {
    if (target) setPendingHighlight({ sourceId: target.sourceId, page: target.page, quote });
  };

  return (
    <span ref={box} className="relative inline-block" onMouseEnter={hoverOpen} onMouseLeave={hoverClose}>
      <button
        type="button"
        className="ml-1 inline-flex min-h-6 min-w-6 items-center justify-center rounded-sm bg-sunken px-1 align-baseline text-xs font-medium text-accent hover:underline"
        aria-label={`Source ${refId}: ${label}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setPinned(!(open && pinned));
          setOpen(!(open && pinned));
        }}
        onFocus={hoverOpen}
        onBlur={hoverClose}
      >
        {refId}
      </button>
      {open ? (
        <span
          id={panelId}
          role="dialog"
          aria-label={`Source ${refId}`}
          className="absolute left-0 top-full z-30 mt-1 block w-[min(28rem,80vw)] rounded-lg border border-border bg-surface p-3 text-left text-sm font-normal text-text shadow-pop"
          onMouseEnter={() => window.clearTimeout(timer.current)}
        >
          <span className="mb-2 block font-semibold text-text">{label}</span>
          <span className="block max-h-60 overflow-y-auto whitespace-pre-wrap leading-relaxed text-text-2">
            {win ? (
              <>
                <MathText text={win.before} />
                <mark className="rounded-sm bg-accent-bg px-0.5 text-text underline decoration-accent decoration-2 underline-offset-2"><MathText text={win.match} /></mark>
                <MathText text={win.after} />
              </>
            ) : (
              <>“<MathText text={quote} />”</>
            )}
          </span>
          {source.ocr ? <span className="mt-2 block text-xs text-text-3">Read from a photo or scan, so check the page itself.</span> : null}
          <span className="mt-3 flex gap-3">
            {source.external ? (
              <a href={source.href} target="_blank" rel="noopener noreferrer" className="font-medium text-accent hover:underline">Open the web page ↗</a>
            ) : (
              <Link to={source.href} onClick={openFile} className="font-medium text-accent hover:underline">{target ? 'Open in the file' : 'Open'}</Link>
            )}
          </span>
        </span>
      ) : null}
    </span>
  );
}
