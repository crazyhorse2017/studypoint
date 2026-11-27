// A course's cards (CRD-01): list, make, edit, delete (with undo), and start reviewing this course.

import { useCallback, useEffect, useState } from 'react';
import { Button, useToast } from '../ds/index.ts';
import { Link } from '../Link.tsx';
import type { CardPayload } from '../../shared/cards.ts';
import { CardEditor } from './CardEditor.tsx';
import { MathText } from './MathText.tsx';
import { deleteCard, fetchCards, restoreCard, type CardItem } from './cardsApi.ts';

const TYPE_LABEL = { basic: 'Front & back', cloze: 'Fill in the blank', occlusion: 'Image occlusion' } as const;

function summary(p: CardPayload | null): string {
  if (!p) return 'Can’t be decrypted';
  if (p.type === 'basic') return p.front;
  if (p.type === 'cloze') return p.text.replace(/\{\{c\d+::((?:[^{}]|\{[^{}]*\})*?)(?:::[^{}]*)?\}\}/g, '[$1]');
  return `${p.masks.length} hidden label${p.masks.length === 1 ? '' : 's'}${p.caption ? ` · ${p.caption}` : ''}`;
}

export function CardsSection({ courseId }: { courseId: string }) {
  const toast = useToast();
  const [cards, setCards] = useState<CardItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; payload: CardPayload } | 'new' | null>(null);

  const refresh = useCallback(() => {
    fetchCards(courseId).then(setCards, (e) => setError(e instanceof Error ? e.message : 'Your cards couldn’t be loaded.'));
  }, [courseId]);
  useEffect(refresh, [refresh]);

  const remove = async (c: CardItem) => {
    try {
      await deleteCard(c.id);
      refresh();
      toast.show({ message: 'Card deleted', action: { label: 'Undo', onAction: () => void restoreCard(c.id).then(refresh) } });
    } catch (e) {
      toast.show({ message: e instanceof Error ? e.message : 'Couldn’t delete the card.', tone: 'error' });
    }
  };

  return (
    <section aria-labelledby="cards-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="cards-heading" className="text-xl font-semibold">
            Cards
          </h2>
          <p className="text-sm text-text-2">Encrypted on this device. Each side, blank or hidden label is scheduled on its own.</p>
        </div>
        <div className="flex gap-2">
          {cards && cards.length > 0 ? (
            <Link to={`/review?course=${encodeURIComponent(courseId)}`} className="inline-flex min-h-10 items-center rounded-md border border-border-strong px-4 text-text hover:bg-sunken">
              Review this course
            </Link>
          ) : null}
          {editing === null ? (
            <Button variant="primary" onClick={() => setEditing('new')}>
              New card
            </Button>
          ) : null}
        </div>
      </div>

      {editing !== null ? (
        <CardEditor
          key={editing === 'new' ? 'new' : editing.id}
          courseId={courseId}
          editing={editing === 'new' ? null : editing}
          onDone={() => {
            setEditing(null);
            refresh();
          }}
        />
      ) : null}

      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {cards === null && !error ? <p className="text-text-2">Decrypting your cards…</p> : null}
      {cards !== null && cards.length === 0 && editing === null ? <p className="rounded-lg border border-dashed border-border-strong p-5 text-text-2">No cards yet. Make one with New card.</p> : null}
      {cards !== null && cards.length > 0 ? (
        <ul className="rounded-lg border border-border bg-surface px-5">
          {cards.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-3 last:border-0">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className={`line-clamp-2 ${c.payload ? 'text-text' : 'text-danger'}`}>
                  <MathText text={summary(c.payload)} />
                </span>
                <span className="text-sm text-text-3">
                  {TYPE_LABEL[c.type]}
                  {c.payload?.type === 'basic' && c.payload.answerMode === 'typed' ? ' · typed answer' : ''}
                  {c.variants.length > 1 ? ` · ${c.variants.length} cards` : ''}
                </span>
              </span>
              <span className="flex gap-1">
                {c.payload ? (
                  <Button size="sm" variant="ghost" onClick={() => setEditing({ id: c.id, payload: c.payload as CardPayload })}>
                    Edit
                  </Button>
                ) : null}
                <Button size="sm" variant="ghost" aria-label="Delete card" onClick={() => void remove(c)}>
                  Delete
                </Button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
