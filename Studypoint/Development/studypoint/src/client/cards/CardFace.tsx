// One side of a card as it's studied (CRD-01): the question, and after "Show answer" the answer.
// Used by the review session and by the editor's preview.

import { useEffect, useState } from 'react';
import { clozePieces, type CardPayload, type Mask } from '../../shared/cards.ts';
import { Latex, MathText } from './MathText.tsx';
import { occlusionImageUrl } from './occlusionImage.ts';

function OcclusionFace({ fileId, page, masks, active, revealed, mode, caption }: {
  fileId: string; page: number | null; masks: readonly Mask[]; active: string | null; revealed: boolean; mode: 'hide-one' | 'hide-all'; caption: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    occlusionImageUrl(fileId, page).then((u) => live && setUrl(u), (e) => live && setError(e instanceof Error ? e.message : 'The picture couldn’t be loaded.'));
    return () => {
      live = false;
    };
  }, [fileId, page]);
  if (error) return <p className="text-danger">{error}</p>;
  if (!url) return <p className="text-text-2">Decrypting the picture…</p>;
  const activeMask = masks.find((m) => m.id === active);
  return (
    <figure className="flex flex-col items-center gap-2">
      <div className="relative inline-block max-w-full">
        <img src={url} alt={caption || 'Diagram with hidden labels'} className="block max-h-[65vh] max-w-full" />
        {masks.map((m) => {
          const isActive = m.id === active;
          const hidden = isActive ? !revealed : mode === 'hide-all';
          if (!hidden && !isActive) return null;
          return (
            <span
              key={m.id}
              aria-hidden="true"
              className={`absolute rounded-sm border-2 ${isActive ? 'border-accent' : 'border-border-strong'} ${hidden ? (isActive ? 'bg-accent' : 'bg-sunken') : 'bg-transparent'}`}
              style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%`, width: `${m.w * 100}%`, height: `${m.h * 100}%` }}
            />
          );
        })}
      </div>
      <figcaption className="text-center text-text-2">
        {revealed && activeMask ? (
          <span className="text-lg text-text">
            <MathText text={activeMask.label || '(no label)'} />
          </span>
        ) : (
          <span>What’s under the highlighted box?{caption ? ` · ${caption}` : ''}</span>
        )}
      </figcaption>
    </figure>
  );
}

export function CardFace({ payload, variant, revealed }: { payload: CardPayload; variant: string; revealed: boolean }) {
  if (payload.type === 'basic') {
    const reverse = variant === 'reverse';
    const q = reverse ? payload.back : payload.front;
    const a = reverse ? payload.front : payload.back;
    return (
      <div className="flex flex-col gap-6 text-center">
        <div className="text-2xl leading-relaxed text-text"><MathText text={q} /></div>
        {revealed ? (
          <>
            <hr className="border-border" />
            <div className="text-xl leading-relaxed text-text"><MathText text={a} /></div>
          </>
        ) : null}
      </div>
    );
  }
  if (payload.type === 'cloze') {
    const n = Number(variant.replace(/^c/, '')) || 1;
    return (
      <div className="flex flex-col gap-6 text-center">
        <p className="text-2xl leading-relaxed text-text">
          {clozePieces(payload.text, n).map((p, i) =>
            p.kind === 'text' ? (
              <MathText key={i} text={p.text} />
            ) : revealed ? (
              <mark key={i} className="rounded-sm bg-sunken px-1 font-semibold text-accent">
                <MathText text={p.answer} />
              </mark>
            ) : (
              <span key={i} className="rounded-sm border-b-2 border-accent px-2 text-accent" aria-label={p.hint ? `blank, hint: ${p.hint}` : 'blank'}>
                [{p.hint ?? '…'}]
              </span>
            ),
          )}
        </p>
        {revealed && payload.extra.trim() ? <div className="text-text-2"><MathText text={payload.extra} /></div> : null}
      </div>
    );
  }
  const maskId = variant.startsWith('m:') ? variant.slice(2) : null;
  return <OcclusionFace fileId={payload.fileId} page={payload.page} masks={payload.masks} active={maskId} revealed={revealed} mode={payload.mode} caption={payload.caption} />;
}

export { Latex };
