// Today's study-plan work across courses (step 6b), for the Today page: a practice test waiting, or how
// many plan tasks are left today, each linking to the course's Plan tab.

import { useEffect, useState } from 'react';
import { Link } from '../Link.tsx';
import { dayKey } from '../../shared/studyPlan.ts';
import { fetchPlans, type LoadedPlan } from './planApi.ts';
import { usePlanVersion } from './planJobs.ts';

export function TodayPlans({ label }: { label: (courseId: string) => string }) {
  const version = usePlanVersion();
  const [plans, setPlans] = useState<LoadedPlan[] | null>(null);
  useEffect(() => {
    fetchPlans().then(setPlans, () => setPlans([]));
  }, [version]);
  if (!plans || plans.length === 0) return null;
  const today = dayKey(Date.now());
  const rows = plans.map((p) => {
    const tasks = p.plan.days.find((d) => d.day === today)?.tasks ?? [];
    const left = tasks.filter((t) => !t.done).length;
    const test = p.plan.test && !p.plan.test.takenAt;
    const text =
      p.stage === 'building' ? 'Practice test being made…'
        : p.stage === 'failed' ? 'Practice test couldn’t be made'
          : test ? (p.plan.test?.kind === 'weekly' ? 'Weekly check-in test ready' : 'Practice test ready')
            : left ? `${left} plan task${left === 1 ? '' : 's'} today`
              : tasks.length ? 'Plan done for today ✓' : 'Nothing planned today';
    return { id: p.courseId, text, urgent: Boolean(test || left) };
  });
  return (
    <section aria-labelledby="plans-heading" className="flex flex-col gap-3">
      <h2 id="plans-heading" className="text-lg font-semibold">Study plans</h2>
      <ul className="flex flex-col gap-2">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-3 rounded-md border border-border bg-surface px-4 py-3">
            <Link to={`/courses/${r.id}?tab=plan`} className="font-semibold text-text hover:text-accent">{label(r.id)}</Link>
            <span className={r.urgent ? 'text-sm font-medium text-text' : 'text-sm text-text-2'}>{r.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
