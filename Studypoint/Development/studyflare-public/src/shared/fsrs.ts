// FSRS scheduling (CRD-05, ARCHITECTURE A11) through ts-fsrs, shared by the browser (interval previews on
// the rating buttons) and the Worker (the authoritative schedule written to card_states + review_log).
// The only place that converts between our card_states rows and ts-fsrs cards. Types and helpers that
// don't need the library are in fsrsState.ts.

import { State, fsrs, generatorParameters, type Card, type Grade } from 'ts-fsrs';
import { capDueForExam } from './examCram.ts';
import type { DbState, RatingNumber, StateRow } from './fsrsState.ts';

export { FSRS_VERSION, formatInterval, newStateRow, paramsHash } from './fsrsState.ts';
export type { DbState, RatingNumber, StateRow } from './fsrsState.ts';

const TO_STATE: Record<DbState, State> = { new: State.New, learning: State.Learning, review: State.Review, relearning: State.Relearning };
const FROM_STATE = new Map<State, DbState>([[State.New, 'new'], [State.Learning, 'learning'], [State.Review, 'review'], [State.Relearning, 'relearning']]);

function toCard(r: StateRow): Card {
  return {
    due: new Date(r.due_at),
    stability: r.stability ?? 0,
    difficulty: r.difficulty ?? 0,
    scheduled_days: r.scheduled_days ?? 0,
    learning_steps: r.learning_steps,
    reps: r.reps,
    lapses: r.lapses,
    state: TO_STATE[r.state],
    last_review: r.last_review_at === null ? undefined : new Date(r.last_review_at),
  };
}

function fromCard(c: Card): StateRow {
  return {
    state: FROM_STATE.get(c.state) ?? 'review',
    due_at: c.due.getTime(),
    stability: c.stability,
    difficulty: c.difficulty,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    last_review_at: c.last_review ? c.last_review.getTime() : null,
  };
}

/** A scheduler for this retention target. No fuzz, so the browser's previews match what the Worker saves. */
export function scheduler(retention: number) {
  return fsrs(generatorParameters({ request_retention: Math.min(0.97, Math.max(0.7, retention)), enable_fuzz: false, enable_short_term: true }));
}

export type Outcome = { next: StateRow; scheduledDays: number };

/** The state after rating `rating` at `now`, with the exam cap applied (CRD-07). */
export function review(row: StateRow, rating: RatingNumber, now: number, retention: number, examAt: number | null): Outcome {
  const item = scheduler(retention).next(toCard(row), new Date(now), rating as Grade);
  const next = fromCard(item.card);
  next.due_at = capDueForExam(next.due_at, examAt, now);
  return { next, scheduledDays: item.log.scheduled_days };
}

/** When each rating would bring the card back (for the buttons), in ms from now. */
export function previewIntervals(row: StateRow, now: number, retention: number, examAt: number | null): Record<RatingNumber, number> {
  const out = {} as Record<RatingNumber, number>;
  for (const r of [1, 2, 3, 4] as const) out[r] = review(row, r, now, retention, examAt).next.due_at - now;
  return out;
}
