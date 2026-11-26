// Today (DESIGN §6). The app ships blank (LIB-12), so the first run is a welcome panel.
// Choosing a school and adding courses arrive in P1 (T1.02a/b, T1.24); this says so honestly.

import { Link } from '../Link.tsx';

export function TodayPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <h1 className="text-[2.125rem] leading-tight font-semibold">Welcome to Studypoint</h1>
      <p className="reading text-text-2">
        Everything here will come from your own sources: the files, links and lookups you add. Nothing is preloaded.
      </p>
      <section aria-labelledby="setup-heading" className="rounded-lg border border-border bg-surface p-6">
        <h2 id="setup-heading" className="text-lg font-semibold">
          Getting started
        </h2>
        <ol className="mt-4 flex flex-col gap-3 text-text-2">
          <li className="flex gap-3">
            <span aria-hidden="true" className="font-mono text-text-3">
              1
            </span>
            <span>
              <span className="text-text">Choose your school.</span> Course codes will match your school's catalog. Coming soon.
            </span>
          </li>
          <li className="flex gap-3">
            <span aria-hidden="true" className="font-mono text-text-3">
              2
            </span>
            <span>
              <span className="text-text">Add your first course</span> by code, file upload, link or topic lookup. Coming soon.
            </span>
          </li>
          <li className="flex gap-3">
            <span aria-hidden="true" className="font-mono text-text-3">
              3
            </span>
            <span>
              <span className="text-text">Make it yours.</span> Pick a style and reading settings in{' '}
              <Link to="/settings" className="text-accent underline underline-offset-2">
                Settings
              </Link>
              .
            </span>
          </li>
        </ol>
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
        That address doesn't match anything in Studypoint.{' '}
        <Link to="/" className="text-accent underline underline-offset-2">
          Go to Today
        </Link>
        .
      </p>
    </div>
  );
}
