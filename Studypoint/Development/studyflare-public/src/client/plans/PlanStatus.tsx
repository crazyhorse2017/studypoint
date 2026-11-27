// A small status line while study-plan work runs in the background (step 6b): what's being made, for which
// course, and how far along. Announced politely to screen readers; links to the course's plan.

import { Link } from '../Link.tsx';
import { usePlanJob } from './planJobs.ts';

export function PlanStatus() {
  const job = usePlanJob();
  if (!job) return null;
  const { step, done, total } = job.progress;
  const pct = total > 1 ? Math.round((done / total) * 100) : null;
  return (
    <div className="fixed right-4 bottom-4 z-40 max-w-sm rounded-lg border border-border bg-surface px-4 py-3 text-sm shadow-pop" role="status" aria-live="polite">
      <Link to={`/courses/${job.courseId}?tab=plan`} className="block font-semibold text-text hover:text-accent">
        Study plan · {job.courseName}
      </Link>
      <span className="block text-text-2">
        {step}
        {total > 1 ? ` (${done} of ${total})` : '…'}
      </span>
      {pct !== null ? (
        <span aria-hidden="true" className="mt-2 block h-1 overflow-hidden rounded-full bg-sunken">
          <span className="block h-full bg-accent" style={{ width: `${pct}%` }} />
        </span>
      ) : null}
      <span className="mt-1 block text-xs text-text-3">Keep Studyflare open in a tab; it carries on after a reload.</span>
    </div>
  );
}
