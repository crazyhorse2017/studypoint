// Daily review budget (CRD-06, AI_SYSTEM §9). Pure.
// Alex sets minutes per day. Reviews that are due always come first; new cards fill whatever time is left,
// up to a cap. If due reviews alone exceed the budget, no new cards are introduced (backlog mode).

export const DEFAULT_REVIEW_SECONDS = 10;
export const DEFAULT_NEW_CARD_SECONDS = 40;
export const MAX_NEW_PER_DAY = 30;

export function median(values: readonly number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? (v[mid] as number) : ((v[mid - 1] as number) + (v[mid] as number)) / 2;
}

export type BudgetInput = {
  dailyMinutes: number;
  dueReviews: number;
  /** Durations (ms) of Alex's recent review ratings, newest last; only the last 200 are used. */
  recentReviewMs?: readonly number[];
  /** Durations (ms) of recent new cards' whole first day, including learning steps. */
  recentNewCardMs?: readonly number[];
  /** New cards available to introduce. */
  newAvailable: number;
};

export type BudgetPlan = {
  newToday: number;
  /** Estimated minutes for due reviews + planned new cards. */
  estimatedMinutes: number;
  backlog: boolean;
  secondsPerReview: number;
  secondsPerNewCard: number;
};

export function planDailyBudget(input: BudgetInput): BudgetPlan {
  const tReview = (median((input.recentReviewMs ?? []).slice(-200)) ?? DEFAULT_REVIEW_SECONDS * 1000) / 1000;
  const tNew = (median((input.recentNewCardMs ?? []).slice(-200)) ?? DEFAULT_NEW_CARD_SECONDS * 1000) / 1000;
  const budgetSeconds = Math.max(0, input.dailyMinutes) * 60;
  const reviewSeconds = Math.max(0, input.dueReviews) * tReview;
  const backlog = reviewSeconds > budgetSeconds;
  const room = backlog ? 0 : Math.floor((budgetSeconds - reviewSeconds) / tNew);
  const newToday = Math.max(0, Math.min(room, MAX_NEW_PER_DAY, Math.max(0, input.newAvailable)));
  return {
    newToday,
    estimatedMinutes: Math.round((reviewSeconds + newToday * tNew) / 60),
    backlog,
    secondsPerReview: Number(tReview.toFixed(1)),
    secondsPerNewCard: Number(tNew.toFixed(1)),
  };
}
