// Today (DESIGN §6). The app ships blank (LIB-12): first run walks through choosing a school and
// adding the first course. Afterwards Today shows the courses (reviews and more arrive in P1).

import { useState, type ReactNode } from 'react';
import { Button } from '../ds/index.ts';
import { Link } from '../Link.tsx';
import { useStudy } from '../studyStore.ts';
import { AddCourse } from './AddCourse.tsx';
import { SchoolPicker } from './SchoolPicker.tsx';

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children?: ReactNode }) {
  return (
    <li className="flex gap-4">
      <span
        aria-hidden="true"
        className={
          done
            ? 'flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-sm text-on-accent'
            : 'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border-strong font-mono text-sm text-text-2'
        }
      >
        {done ? '✓' : n}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <h3 className="text-base font-semibold text-text">
          {title}
          {done ? <span className="sr-only"> (done)</span> : null}
        </h3>
        {children}
      </div>
    </li>
  );
}

export function TodayPage() {
  const { loaded, error, school, courses } = useStudy();
  const [changingSchool, setChangingSchool] = useState(false);
  const active = courses.filter((c) => !c.archived);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <h1 className="text-[2.125rem] leading-tight font-semibold">{active.length > 0 ? 'Today' : 'Welcome to Studyflare'}</h1>
      {active.length === 0 ? (
        <p className="reading text-text-2">Everything here will come from your own sources: the files, links and lookups you add. Nothing is preloaded.</p>
      ) : null}

      {!loaded ? <p className="text-text-2">Loading…</p> : null}
      {error ? (
        <p role="alert" className="rounded-md border border-danger bg-surface p-3 text-sm text-danger">
          {error}
        </p>
      ) : null}

      {loaded && !error ? (
        <section aria-labelledby="setup-heading" className="rounded-lg border border-border bg-surface p-6">
          <h2 id="setup-heading" className="mb-5 text-lg font-semibold">
            {active.length === 0 ? 'Getting started' : 'Your courses'}
          </h2>
          <ol className="flex flex-col gap-6">
            <Step n={1} title="Choose your school" done={!!school && !changingSchool}>
              {school && !changingSchool ? (
                <p className="flex flex-wrap items-center gap-x-3 text-text-2">
                  <span className="text-text">{school.name}</span>
                  <button type="button" className="text-sm text-accent underline underline-offset-2" onClick={() => setChangingSchool(true)}>
                    Change
                  </button>
                </p>
              ) : (
                <SchoolPicker onDone={() => setChangingSchool(false)} />
              )}
            </Step>
            <Step n={2} title={active.length === 0 ? 'Add your first course' : 'Add another course'} done={active.length > 0}>
              {active.length > 0 ? (
                <ul className="flex flex-col gap-1">
                  {active.map((c) => (
                    <li key={c.id} className="flex items-baseline gap-2">
                      {c.code ? <span className="font-mono text-sm text-text-2">{c.code}</span> : null}
                      <span className="text-text">{c.title ?? c.name}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {school ? <AddCourse /> : <p className="text-sm text-text-2">Choose your school first, so course codes match its catalog.</p>}
            </Step>
            <Step n={3} title="Make it yours" done={false}>
              <p className="text-text-2">
                Pick a style and reading settings in{' '}
                <Link to="/settings" className="text-accent underline underline-offset-2">
                  Settings
                </Link>
                .
              </p>
            </Step>
          </ol>
        </section>
      ) : null}
      {error ? (
        <div>
          <Button onClick={() => location.reload()}>Try again</Button>
        </div>
      ) : null}
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
