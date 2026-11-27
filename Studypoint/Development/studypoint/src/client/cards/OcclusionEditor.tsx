// Image occlusion editor (CRD-01): pick a photo or a PDF page from this course's files, then cover the
// labels to learn. Draw boxes by dragging, OR use "Add box" and move/resize the selected box with the
// arrow keys (Shift+arrows resizes): every drag has a keyboard alternative (AGENTS 19).

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Button, SegmentedControl, Select, TextField } from '../ds/index.ts';
import { fetchFiles, type FileItem } from '../files/filesApi.ts';
import type { Mask } from '../../shared/cards.ts';
import { occlusionImageUrl, pdfPageCount } from './occlusionImage.ts';

export type OcclusionDraft = { fileId: string | null; page: number | null; masks: Mask[]; caption: string; mode: 'hide-one' | 'hide-all' };

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const newId = () => Math.random().toString(36).slice(2, 10);

export function OcclusionEditor({ courseId, draft, onChange }: { courseId: string; draft: OcclusionDraft; onChange: (d: OcclusionDraft) => void }) {
  const [files, setFiles] = useState<FileItem[] | null>(null);
  const [pages, setPages] = useState(1);
  const [url, setUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; id: string } | null>(null);

  useEffect(() => {
    fetchFiles(courseId).then((r) => setFiles(r.files.filter((f) => f.status === 'ready' && (f.kind === 'image' || f.kind === 'pdf'))), () => setFiles([]));
  }, [courseId]);

  useEffect(() => {
    if (!draft.fileId) return;
    let live = true;
    setUrl(null);
    setLoadError(null);
    occlusionImageUrl(draft.fileId, draft.page).then((u) => live && setUrl(u), (e) => live && setLoadError(e instanceof Error ? e.message : 'Couldn’t load the picture.'));
    pdfPageCount(draft.fileId).then((n) => live && setPages(n), () => undefined);
    return () => {
      live = false;
    };
  }, [draft.fileId, draft.page]);

  const update = (id: string, patch: Partial<Mask>) => onChange({ ...draft, masks: draft.masks.map((m) => (m.id === id ? { ...m, ...patch } : m)) });
  const remove = (id: string) => {
    onChange({ ...draft, masks: draft.masks.filter((m) => m.id !== id) });
    setSelected(null);
  };
  const addCentered = () => {
    const m: Mask = { id: newId(), x: 0.4, y: 0.45, w: 0.2, h: 0.1, label: '' };
    onChange({ ...draft, masks: [...draft.masks, m] });
    setSelected(m.id);
  };

  const point = (e: ReactPointerEvent) => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) };
  };
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).dataset['surface']) return;
    const p = point(e);
    const id = newId();
    drag.current = { ...p, id };
    e.currentTarget.setPointerCapture(e.pointerId);
    onChange({ ...draft, masks: [...draft.masks, { id, x: p.x, y: p.y, w: 0, h: 0, label: '' }] });
    setSelected(id);
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const p = point(e);
    update(d.id, { x: Math.min(d.x, p.x), y: Math.min(d.y, p.y), w: Math.abs(p.x - d.x), h: Math.abs(p.y - d.y) });
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d) {
      const m = draft.masks.find((x) => x.id === d.id);
      if (m && (m.w < 0.01 || m.h < 0.01)) remove(d.id); // a click, not a drag
    }
  };

  const nudge = (e: ReactKeyboardEvent, m: Mask) => {
    const step = e.altKey ? 0.002 : 0.01;
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      remove(m.id);
      return;
    }
    if (!dx && !dy) return;
    e.preventDefault();
    if (e.shiftKey) update(m.id, { w: clamp(m.w + dx, 0.01, 1 - m.x), h: clamp(m.h + dy, 0.01, 1 - m.y) });
    else update(m.id, { x: clamp(m.x + dx, 0, 1 - m.w), y: clamp(m.y + dy, 0, 1 - m.h) });
  };

  if (files === null) return <p className="text-text-2">Finding pictures and PDFs in this course…</p>;
  if (files.length === 0) return <p className="text-text-2">Upload a photo or a PDF to this course first (Files tab). Image occlusion hides parts of a picture or a PDF page.</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1">
          <Select
            label="Picture or PDF"
            value={draft.fileId}
            placeholder="Choose a file"
            options={files.map((f) => ({ value: f.id, label: `${f.title} (${f.kind === 'pdf' ? 'PDF' : 'image'})` }))}
            onChange={(id) => onChange({ ...draft, fileId: id, page: files.find((f) => f.id === id)?.kind === 'pdf' ? 1 : null, masks: [] })}
          />
        </div>
        {draft.page !== null && pages > 1 ? (
          <div className="w-40">
            <Select
              label="Page"
              value={String(draft.page)}
              options={Array.from({ length: pages }, (_, i) => ({ value: String(i + 1), label: `Page ${i + 1}` }))}
              onChange={(p) => onChange({ ...draft, page: Number(p), masks: [] })}
            />
          </div>
        ) : null}
      </div>
      {loadError ? <p className="text-danger">{loadError}</p> : null}
      {draft.fileId && !url && !loadError ? <p className="text-text-2">Decrypting the picture…</p> : null}
      {url ? (
        <>
          <p className="text-sm text-text-2">Drag over each label to hide it. Or press Add box, then use the arrow keys to move it and Shift+arrows to resize.</p>
          <div
            ref={box}
            className="relative inline-block max-w-full cursor-crosshair select-none self-start touch-none"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
          >
            <img src={url} alt="" data-surface="1" draggable={false} className="block max-h-[60vh] max-w-full" />
            {draft.masks.map((m, i) => (
              <button
                key={m.id}
                type="button"
                aria-label={`Box ${i + 1}${m.label ? `: ${m.label}` : ''}. Arrow keys move, Shift+arrows resize, Delete removes.`}
                aria-pressed={selected === m.id}
                onClick={() => setSelected(m.id)}
                onKeyDown={(e) => nudge(e, m)}
                className={`absolute rounded-sm border-2 ${selected === m.id ? 'border-accent bg-accent/60' : 'border-border-strong bg-sunken/80'}`}
                style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%`, width: `${m.w * 100}%`, height: `${m.h * 100}%` }}
              >
                <span className="sr-only">{m.label}</span>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={addCentered}>
              Add box
            </Button>
          </div>
          {draft.masks.length > 0 ? (
            <ol className="flex flex-col gap-2">
              {draft.masks.map((m, i) => (
                <li key={m.id} className="flex flex-wrap items-end gap-2">
                  <div className="min-w-56 flex-1">
                    <TextField
                      label={`Answer for box ${i + 1}`}
                      value={m.label}
                      placeholder="What's hidden, e.g. Mitral valve"
                      onFocus={() => setSelected(m.id)}
                      onChange={(e) => update(m.id, { label: e.target.value })}
                    />
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => remove(m.id)}>
                    Remove
                  </Button>
                </li>
              ))}
            </ol>
          ) : null}
          <SegmentedControl
            label="When studying"
            value={draft.mode}
            options={[
              { value: 'hide-one', label: 'Hide one, show the rest' },
              { value: 'hide-all', label: 'Hide all, ask one' },
            ]}
            onChange={(mode) => onChange({ ...draft, mode })}
          />
          <TextField label="Caption (optional)" value={draft.caption} onChange={(e) => onChange({ ...draft, caption: e.target.value })} placeholder="e.g. Heart, anterior view" />
        </>
      ) : null}
    </div>
  );
}
