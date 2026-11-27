// FSRS card-state types and small helpers that don't need the ts-fsrs library (so the Worker's routing
// and the local tests can load without it). The scheduling itself is in fsrs.ts.

export const FSRS_VERSION = 'ts-fsrs@6.0.1/fsrs-6';

export type DbState = 'new' | 'learning' | 'review' | 'relearning';

/** The scheduling fields of one card_states row. */
export type StateRow = {
  state: DbState;
  due_at: number;
  stability: number | null;
  difficulty: number | null;
  scheduled_days: number | null;
  learning_steps: number;
  reps: number;
  lapses: number;
  last_review_at: number | null;
};

export type RatingNumber = 1 | 2 | 3 | 4; // Again, Hard, Good, Easy

export function newStateRow(now: number): StateRow {
  return { state: 'new', due_at: now, stability: null, difficulty: null, scheduled_days: null, learning_steps: 0, reps: 0, lapses: 0, last_review_at: null };
}

/** Short hash of the scheduling parameters, stored with every review (AGENTS 9). */
export function paramsHash(retention: number): string {
  return `r${Math.round(retention * 100)}-default-w`;
}

/** "1 min", "10 min", "3 h", "4 d", "2 mo", "1.5 y". */
export function formatInterval(ms: number): string {
  const min = ms / 60_000;
  if (min < 60) return `${Math.max(1, Math.round(min))} min`;
  const h = min / 60;
  if (h < 24) return `${Math.round(h)} h`;
  const d = h / 24;
  if (d < 31) return `${Math.round(d)} d`;
  if (d < 365) return `${Math.round(d / 30)} mo`;
  return `${(d / 365).toFixed(d < 3650 ? 1 : 0)} y`;
}
