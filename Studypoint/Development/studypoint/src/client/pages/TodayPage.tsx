// Today (DESIGN §6): only about studying today. What's due and how long it should take, a Start review
// button, upcoming exams with whether you're on track, and your courses. Setup lives on /setup.

import { useEffect, useState } from 'react';
import { Button } from '../ds/index.ts';
import { Link } from '../Link.tsx';
import { useStudy } from '../studyStore.ts';
import { fetchSummary, type Summary } from '../cards/cardsApi.ts';
import { planDailyBudget } from '../../shared/budget.ts';

const fmtDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

export function TodayPage() {
  const { loaded, error, courses } = useStudy();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const active = courses.filter((c) => !c.archived);

  useEffect(() => {
    fetchSummary().then(setSummary, (e) => setSummaryError(e instanceof Error ? e.message : 'Today’s numbers couldn’t be loaded.'));
  }, []);

  const label = (id: string) => {
    const c = courses.find((x) => x.id === id);
    return c ? (c.code ?? c.name) : 'A course';
  };

  if (loaded && !error && active.length === 0) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <h1 className="text-[2.125rem] leading-tight font-semibold">Welcome to Studyflare</h1>
        <p className="reading text-text-2">Start by adding a course or a subject you’re learning. Everything else grows from your own material.</p>
        <div>
          <Link to="/setup" className="inline-flex min-h-10 items-center rounded-md bg-accent px-4 font-semibold text-on-accent hover:opacity-90">
            Get started
          </Link>
        </div>
      </div>
    );
  }

  const toReview = summary ? summary.dueNow + summary.newToday : 0;
  const minutes = summary ? planDailyBudget({ dailyMinutes: 600, dueReviews: summary.dueNow, newAvailable: summary.newToday }).estimatedMinutes : 0;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <h1 className="text-[2.125rem] leading-tight font-semibold">Today</h1>
      {error ? (
        <div className="flex flex-col gap-2">
          <p role="alert" className="text-danger">{error}</p>
          <div><Button onClick={() => location.reload()}>Try again</Button></div>
        </div>
      ) : null}

      <section aria-labelledby="review-heading" className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-6">
        <h2 id="review-heading" className="text-lg font-semibold">Review</h2>
        {summaryError ? <p className="text-danger">{summaryError}</p> : null}
        {!summary && !summaryError ? <p className="text-text-2">Counting today’s cards…</p> : null}
        {summary ? (
          toReview > 0 ? (
            <>
              <p className="text-text">
                <span className="text-3xl font-semibold">{toReview}</span> card{toReview === 1 ? '' : 's'} today
                <span className="text-text-2"> · {summary.dueNow} due, {summary.newToday} new · about {Math.max(1, minutes)} min</span>
              </p>
              <div>
                <Link to="/review" className="inline-flex min-h-10 items-center rounded-md bg-accent px-5 font-semibold text-on-accent hover:opacity-90">
                  Start review
                </Link>
              </div>
            </>
          ) : (
            <p className="text-text-2">
              {summary.reviewedToday > 0 ? `Done for today: ${summary.reviewedToday} reviews.` : 'Nothing due.'}{' '}
              {summary.newAvailable === 0 ? 'Make cards in a course to start reviewing.' : ''}
            </p>
          )
        ) : null}
      </section>

      {summary && summary.exams.length > 0 ? (
        <section aria-labelledby="exams-heading" className="flex flex-col gap-3">
          <h2 id="exams-heading" className="text-lg font-semibold">Upcoming exams</h2>
          <ul className="flex flex-col gap-2">
            {summary.exams.map((e) => (
              <li key={e.courseId} className="flex flex-wrap items-baseline justify-between gap-3 rounded-md border border-border bg-surface px-4 py-3">
                <Link to={`/courses/${e.courseId}`} className="font-semibold text-text hover:text-accent">{label(e.courseId)}</Link>
                <span className="text-sm text-text-2">
                  {fmtDate(e.at)} · {e.daysLeft} day{e.daysLeft === 1 ? '' : 's'} left ·{' '}
                  {e.onTrack ? <span>on track</span> : <span className="text-danger">{e.unseen} cards not seen yet</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="courses-heading" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="courses-heading" className="text-lg font-semibold">Your courses</h2>
          <Link to="/library" className="text-sm text-accent underline underline-offset-2">Library</Link>
        </div>
        <ul className="grid gap-2 sm:grid-cols-2">
          {active.map((c) => (
            <li key={c.id}>
              <Link to={`/courses/${c.id}`} className="flex h-full flex-col rounded-md border border-border bg-surface px-4 py-3 hover:border-accent">
                <span className="flex items-baseline gap-2">
                  {c.code ? <span className="font-mono text-sm text-text-2">{c.code}</span> : null}
                  <span className="text-text">{c.name}</span>
                </span>
                <span className="text-sm text-text-3">{c.school ? c.school.name : 'Personal subject'}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function ComingSoonPage({ title, what }: { title: string; what: string }) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <h1 className="text-[2.125rem] leading-tight font-semibold">{title}</h1>
      <p className="reading text-text-2">{what}</p>
    </div>
  );
}

export function NotFoundPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <h1 className="text-[2.125rem] leading-tight font-semibold">Page not found</h1>
      <p className="text-text-2">
        That address doesn't match anything in Studyflare.{' '}
        <Link to="/" className="text-accent underline underline-offset-2">
          Go to Today
        </Link>
        .
      </p>
    </div>
  );
}
