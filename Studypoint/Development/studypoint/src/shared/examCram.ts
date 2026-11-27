// Exam cram mode (CRD-07, Alex's choice 2026-11-26). Pure.
// With an exam date on a course, no card in that course may be scheduled past the exam: if the normal
// FSRS interval would carry it beyond, it's pulled in so it's seen at least once more before the exam.
// New cards in courses with an exam coming are introduced first, and Today warns when the unseen cards
// can't all be met in time at the daily new-card limit.

const DAY = 86_400_000;

/** Latest moment a card may be due so it's still reviewed before the exam: the day before, at the same time. */
export function cramDeadline(examAt: number): number {
  return examAt - DAY;
}

/**
 * The due time to store. Unchanged if there's no upcoming exam or the interval already ends before it;
 * otherwise capped at the cram deadline (but never earlier than `now + minGapMs`, so a card isn't asked
 * again instantly).
 */
export function capDueForExam(dueAt: number, examAt: number | null, now: number, minGapMs = 10 * 60_000): number {
  if (examAt === null || examAt <= now) return dueAt;
  const latest = cramDeadline(examAt);
  // Reviewed within the last day before the exam: that review IS the "once more before the exam".
  if (latest <= now) return dueAt;
  if (dueAt <= latest) return dueAt;
  return Math.max(now + minGapMs, Math.min(dueAt, latest));
}

export type CramStatus = {
  daysLeft: number;
  unseen: number;
  /** Unseen cards that the new-card limit can introduce before the exam. */
  canIntroduce: number;
  onTrack: boolean;
};

/** Is there time to see every unseen card at least once before the exam? */
export function cramStatus(examAt: number, now: number, unseen: number, newPerDay: number): CramStatus {
  const daysLeft = Math.max(0, Math.floor((cramDeadline(examAt) - now) / DAY) + 1);
  const canIntroduce = daysLeft * Math.max(0, newPerDay);
  return { daysLeft, unseen, canIntroduce, onTrack: unseen <= canIntroduce };
}

/** New cards to introduce today for one course: its fair share to meet the exam, at least the normal pace. */
export function cramNewToday(unseen: number, daysLeft: number, normalPerDay: number): number {
  if (daysLeft <= 0) return unseen;
  return Math.min(unseen, Math.max(normalPerDay, Math.ceil(unseen / daysLeft)));
}

/**
 * Interleave cards from different groups (courses/topics) so the same topic doesn't come twice in a row
 * when avoidable (ADP-03 / CRD-09): round-robin over the groups, in the order given within each group.
 */
export function interleave<T>(items: readonly T[], groupOf: (t: T) => string): T[] {
  const groups = new Map<string, T[]>();
  for (const it of items) {
    const g = groupOf(it);
    const list = groups.get(g);
    if (list) list.push(it);
    else groups.set(g, [it]);
  }
  const out: T[] = [];
  const lists = [...groups.values()];
  for (let round = 0; out.length < items.length; round += 1) {
    for (const l of lists) {
      const x = l[round];
      if (x !== undefined) out.push(x);
    }
  }
  return out;
}
