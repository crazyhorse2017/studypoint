// Getting started (/setup, DESIGN §6). The app ships blank (LIB-12): choose a school (optional for
// personal subjects), add the first course or subject, and pick a look. Moved out of Today on 2026-11-27,
// so Today is only about studying.

import { useState, type ReactNode } from 'react';
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
        <h2 className="text-base font-semibold text-text">
          {title}
          {done ? <span className="sr-only"> (done)</span> : null}
        </h2>
        {children}
      </div>
    </li>
  );
}

export function GettingStartedPage() {
  const { loaded, school, courses } = useStudy();
  const [changingSchool, setChangingSchool] = useState(false);
  const active = courses.filter((c) => !c.archived);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-[2.125rem] leading-tight font-semibold">Getting started</h1>
        <p className="reading text-text-2">Everything in Studyflare comes from your own material: the files, notes and links you add. Nothing is preloaded.</p>
      </div>
      {!loaded ? <p className="text-text-2">Loading…</p> : (
        <ol className="flex flex-col gap-8 rounded-lg border border-border bg-surface p-6">
          <Step n={1} title="Choose your school (skip it for personal subjects)" done={!!school && !changingSchool}>
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
          <Step n={2} title={active.length === 0 ? 'Add your first course or subject' : 'Add another course or subject'} done={active.length > 0}>
            {active.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {active.map((c) => (
                  <li key={c.id}>
                    <Link to={`/courses/${c.id}`} className="flex items-baseline gap-2 hover:text-accent">
                      {c.code ? <span className="font-mono text-sm text-text-2">{c.code}</span> : null}
                      <span>{c.name}</span>
                      {c.kind === 'personal' ? <span className="text-sm text-text-3">Personal</span> : null}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
            <AddCourse key={school ? 'school' : 'none'} />
          </Step>
          <Step n={3} title="Add material and make cards" done={false}>
            <p className="text-text-2">Open a course to upload files, import links, write notes and make flashcards.</p>
          </Step>
          <Step n={4} title="Make it yours" done={false}>
            <p className="text-text-2">
              Pick a style, reading settings and how many new cards a day in{' '}
              <Link to="/settings" className="text-accent underline underline-offset-2">
                Settings
              </Link>
              .
            </p>
          </Step>
        </ol>
      )}
    </div>
  );
}
