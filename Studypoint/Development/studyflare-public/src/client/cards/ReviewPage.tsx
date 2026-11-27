// The review session (CRD-05/08/09). Due cards first (interleaved across courses), then today's new cards
// (exam courses first). Fully keyboard-driven: Space shows the answer, 1–4 rate it (Again, Hard, Good,
// Easy), U or Ctrl+Z undoes the last rating. Each button shows when that card would come back.
//
// Undo without breaking the append-only review log (AGENTS 9): a rating is held for a few seconds before
// it's sent, and Undo simply cancels it. Once sent, it's permanent.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, TextField, useToast } from '../ds/index.ts';
import { Link } from '../Link.tsx';
import { useLocation } from '../router.ts';
import { useStudy } from '../studyStore.ts';
import { checkTypedAnswer } from '../../shared/cards.ts';
import { interleave } from '../../shared/examCram.ts';
import { formatInterval, previewIntervals, review, type RatingNumber } from '../../shared/fsrs.ts';
import { uuid7 } from '../../shared/uuid7.ts';
import { CardFace } from './CardFace.tsx';
import { MathText } from './MathText.tsx';
import { fetchQueue, sendReview, type Exam, type QueueItem, type StudySettings } from './cardsApi.ts';

const COMMIT_DELAY_MS = 5000;
const RATINGS: ReadonlyArray<{ r: RatingNumber; label: string; key: string }> = [
  { r: 1, label: 'Again', key: '1' },
  { r: 2, label: 'Hard', key: '2' },
  { r: 3, label: 'Good', key: '3' },
  { r: 4, label: 'Easy', key: '4' },
];

type Pending = { item: QueueItem; rating: RatingNumber; clientId: string; reviewedAt: number; durationMs: number; timer: ReturnType<typeof setTimeout> };

export default function ReviewPage() {
  const toast = useToast();
  const { search } = useLocation();
  const courseId = search.get('course');
  const { courses } = useStudy();
  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  const [settings, setSettings] = useState<StudySettings>({ newPerDay: 20, retention: 0.9 });
  const [exams, setExams] = useState<Exam[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [typed, setTyped] = useState('');
  const [done, setDone] = useState(0);
  const [now, setNow] = useState(Date.now());
  const shownAt = useRef(Date.now());
  const pending = useRef<Pending | null>(null);
  const [canUndo, setCanUndo] = useState(false);

  useEffect(() => {
    fetchQueue(courseId).then(
      (q) => {
        setSettings(q.settings);
        setExams(q.exams);
        const due = interleave(q.due, (i) => i.courseId ?? '');
        setQueue([...due, ...interleave(q.fresh, (i) => i.courseId ?? '')]);
      },
      (e) => setError(e instanceof Error ? e.message : 'Your review queue couldn’t be loaded.'),
    );
  }, [courseId]);

  // Clock for "next card in N min" while only learning cards are left.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  const commit = useCallback(async (p: Pending) => {
    try {
      await sendReview({ clientId: p.clientId, cardId: p.item.cardId, variant: p.item.variant, rating: p.rating, reviewedAt: p.reviewedAt, durationMs: p.durationMs });
    } catch {
      // Same clientId on retry, so it can't be counted twice.
      setTimeout(() => void commit(p), 10_000);
      toast.show({ message: 'A rating didn’t save yet. Retrying…', tone: 'error' });
    }
  }, [toast]);

  const flush = useCallback(() => {
    const p = pending.current;
    if (!p) return;
    clearTimeout(p.timer);
    pending.current = null;
    setCanUndo(false);
    void commit(p);
  }, [commit]);

  // Send anything still held when leaving the page.
  useEffect(() => () => flush(), [flush]);

  const examFor = (item: QueueItem) => exams.find((e) => e.courseId === item.courseId)?.at ?? null;

  const current = useMemo(() => {
    if (!queue) return null;
    return queue.find((i) => i.state === 'new' || i.due_at <= now) ?? null;
  }, [queue, now]);
  const waiting = queue && !current ? queue.filter((i) => i.due_at > now).sort((a, b) => a.due_at - b.due_at)[0] ?? null : null;

  useEffect(() => {
    shownAt.current = Date.now();
    setRevealed(false);
    setTyped('');
  }, [current?.cardId, current?.variant]);

  const rate = useCallback((rating: RatingNumber) => {
    if (!current || !queue) return;
    flush(); // the previous rating can't be undone once you rate the next card
    const at = Date.now();
    const { next } = review(current, rating, at, settings.retention, examFor(current));
    const rest = queue.filter((i) => !(i.cardId === current.cardId && i.variant === current.variant));
    // Learning steps (minutes away) come back in this session; longer intervals leave the queue.
    const again = next.due_at - at < 60 * 60_000 ? [{ ...current, ...next }] : [];
    setQueue([...rest, ...again]);
    setDone((d) => d + 1);
    const p: Pending = { item: current, rating, clientId: uuid7(), reviewedAt: at, durationMs: at - shownAt.current, timer: setTimeout(() => flush(), COMMIT_DELAY_MS) };
    pending.current = p;
    setCanUndo(true);
  }, [current, queue, settings.retention, flush]);

  const undo = useCallback(() => {
    const p = pending.current;
    if (!p || !queue) return;
    clearTimeout(p.timer);
    pending.current = null;
    setCanUndo(false);
    const rest = queue.filter((i) => !(i.cardId === p.item.cardId && i.variant === p.item.variant));
    setQueue([p.item, ...rest]);
    setDone((d) => Math.max(0, d - 1));
    toast.show({ message: 'Rating undone' });
  }, [queue, toast]);

  const isTyped = current?.payload?.type === 'basic' && current.payload.answerMode === 'typed';
  const typedCheck = isTyped && revealed && current?.payload?.type === 'basic' ? checkTypedAnswer(typed, current.variant === 'reverse' ? current.payload.front : current.payload.back) : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inField = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if ((e.key === 'z' && (e.ctrlKey || e.metaKey)) || (!inField && (e.key === 'u' || e.key === 'U'))) {
        e.preventDefault();
        undo();
        return;
      }
      if (inField || !current) return;
      if (!revealed && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        setRevealed(true);
      } else if (revealed) {
        const r = RATINGS.find((x) => x.key === e.key);
        if (r) {
          e.preventDefault();
          rate(r.r);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, revealed, rate, undo]);

  const course = courses.find((c) => c.id === courseId);
  const intervals = current && revealed ? previewIntervals(current, Date.now(), settings.retention, examFor(current)) : null;
  const left = queue ? queue.length : 0;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-[2.125rem] leading-tight font-semibold">Review{course ? `: ${course.code ?? course.name}` : ''}</h1>
        {queue ? (
          <p className="text-sm text-text-2" aria-live="polite">
            {done} done · {left} left
          </p>
        ) : null}
      </div>
      {error ? <p className="text-danger">{error}</p> : null}
      {!queue && !error ? <p className="text-text-2">Decrypting today’s cards…</p> : null}

      {queue && !current && !waiting ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-6">
          <p className="text-lg text-text">{done > 0 ? `All done for now: ${done} review${done === 1 ? '' : 's'}.` : 'Nothing to review right now.'}</p>
          <p className="text-text-2">{done > 0 ? 'Come back when more cards are due.' : 'Make cards in a course, or come back when some are due.'}</p>
          <div className="flex gap-2">
            <Link to="/" className="text-accent underline underline-offset-2">Back to Today</Link>
          </div>
          {canUndo ? <div><Button size="sm" variant="ghost" onClick={undo}>Undo last rating</Button></div> : null}
        </div>
      ) : null}

      {queue && !current && waiting ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-6">
          <p className="text-text">Next card in {formatInterval(Math.max(60_000, waiting.due_at - now))} (a learning step).</p>
          <div className="flex gap-2">
            <Button onClick={() => setQueue(queue.map((i) => (i === waiting ? { ...i, due_at: Date.now() } : i)))}>Show it now</Button>
            {canUndo ? <Button variant="ghost" onClick={undo}>Undo last rating</Button> : null}
          </div>
        </div>
      ) : null}

      {current ? (
        <div className="flex flex-col gap-6">
          <div className="min-h-64 rounded-lg border border-border bg-surface p-6 shadow-pop">
            {current.payload ? (
              <CardFace payload={current.payload} variant={current.variant} revealed={revealed} />
            ) : (
              <p className="text-danger">This card can’t be decrypted on this device.</p>
            )}
            {isTyped && !revealed ? (
              <form
                className="mt-6 flex flex-col gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  setRevealed(true);
                }}
              >
                <TextField label="Your answer" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus autoComplete="off" />
              </form>
            ) : null}
            {typedCheck ? (
              <p className={`mt-4 text-center ${typedCheck.correct ? 'text-success' : 'text-danger'}`} role="status">
                {typedCheck.correct ? '✓ Correct' : '✗ Not quite'}
                {typed.trim() ? <> · you typed: <MathText text={typed} /></> : null}
              </p>
            ) : null}
          </div>

          {!revealed ? (
            <div className="flex justify-center gap-2">
              <Button variant="primary" onClick={() => setRevealed(true)}>
                Show answer <span className="ml-2 text-sm opacity-80">Space</span>
              </Button>
              {canUndo ? <Button variant="ghost" onClick={undo}>Undo <span className="ml-1 text-sm opacity-80">U</span></Button> : null}
            </div>
          ) : (
            <div role="group" aria-label="How well did you remember?" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {RATINGS.map(({ r, label, key }) => {
                const suggested = typedCheck ? (typedCheck.correct ? 3 : 1) === r : false;
                return (
                  <Button key={r} variant={suggested ? 'primary' : 'secondary'} onClick={() => rate(r)} aria-keyshortcuts={key}>
                    <span className="flex flex-col items-center leading-tight">
                      <span>{label} <span className="text-sm opacity-70">{key}</span></span>
                      {intervals ? <span className="text-xs opacity-80">{formatInterval(intervals[r])}</span> : null}
                    </span>
                  </Button>
                );
              })}
            </div>
          )}
          <p className="text-center text-xs text-text-3">
            {current.state === 'new' ? 'New card' : current.state === 'review' ? 'Review' : 'Learning'}
            {examFor(current) ? ' · exam mode: due before the exam' : ''}
          </p>
        </div>
      ) : null}
    </div>
  );
}
