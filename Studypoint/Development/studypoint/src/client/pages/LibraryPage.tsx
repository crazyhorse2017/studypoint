// Library (LIB-01, partial): Alex's courses with rename, archive and delete. Sources, units and topics arrive
// with ingestion (needs Workers Paid). Archiving puts a finished semester away (LIB-12).

import { useState } from 'react';
import { Button, ConfirmDialog, Menu, TextField, useToast } from '../ds/index.ts';
import { removeCourse, renameCourse, setArchived, useStudy, type Course } from '../studyStore.ts';
import { AddCourse } from './AddCourse.tsx';
import { Link } from '../Link.tsx';

function CourseRow({ c }: { c: Course }) {
  const toast = useToast();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(c.title ?? c.name);
  const [confirm, setConfirm] = useState(false);
  const fail = (e: unknown) => toast.show({ message: e instanceof Error ? e.message : 'Something went wrong.', tone: 'error' });

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-3 last:border-0">
      {renaming ? (
        <form
          className="flex flex-1 items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            renameCourse(c.id, name).then(() => setRenaming(false), fail);
          }}
        >
          <div className="flex-1">
            <TextField label="Course name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <Button type="submit" variant="primary">
            Save
          </Button>
          <Button variant="ghost" onClick={() => setRenaming(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <div className="flex min-w-0 flex-col">
          <span className="flex items-baseline gap-2">
            {c.code ? <span className="font-mono text-sm text-text-2">{c.code}</span> : null}
            <span className="text-text">{c.name}</span>
            {c.archived ? <span className="rounded-sm bg-sunken px-1.5 text-xs text-text-2">Archived</span> : null}
          </span>
          <span className="text-sm text-text-3">{c.school.name}</span>
        </div>
      )}
      {!renaming ? (
        <Menu
          trigger="Options"
          align="end"
          items={[
            { label: 'Rename', onSelect: () => setRenaming(true) },
            {
              label: c.archived ? 'Unarchive' : 'Archive',
              onSelect: () =>
                setArchived(c.id, !c.archived).then(
                  () =>
                    toast.show({
                      message: c.archived ? 'Course restored' : 'Course archived',
                      action: c.archived ? undefined : { label: 'Undo', onAction: () => void setArchived(c.id, false).catch(fail) },
                    }),
                  fail,
                ),
            },
            { label: 'Delete', destructive: true, onSelect: () => setConfirm(true) },
          ]}
        />
      ) : null}
      <ConfirmDialog
        open={confirm}
        title={`Delete “${c.name}”?`}
        message="This removes the course and its units and topics. Files and cards you added to it stay in your library, unlinked. This can't be undone; archive it instead to put it away."
        confirmLabel="Delete course"
        destructive
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false);
          removeCourse(c.id).then(() => toast.show({ message: 'Course deleted' }), fail);
        }}
      />
    </li>
  );
}

export function LibraryPage() {
  const { loaded, school, courses } = useStudy();
  const active = courses.filter((c) => !c.archived);
  const archived = courses.filter((c) => c.archived);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-[2.125rem] leading-tight font-semibold">Library</h1>
        <p className="text-text-2">Your courses. Uploading files into them turns on with file storage (Workers Paid).</p>
      </div>
      {!loaded ? <p className="text-text-2">Loading…</p> : null}
      {loaded && !school ? (
        <p className="text-text-2">
          <Link to="/" className="text-accent underline underline-offset-2">
            Choose your school on Today
          </Link>{' '}
          to add courses.
        </p>
      ) : null}
      {active.length > 0 ? (
        <section aria-labelledby="courses-heading" className="rounded-lg border border-border bg-surface px-5">
          <h2 id="courses-heading" className="sr-only">
            Courses
          </h2>
          <ul>
            {active.map((c) => (
              <CourseRow key={c.id} c={c} />
            ))}
          </ul>
        </section>
      ) : null}
      {school ? (
        <section aria-labelledby="add-heading" className="flex flex-col gap-4">
          <h2 id="add-heading" className="text-xl font-semibold">
            Add a course
          </h2>
          <AddCourse />
        </section>
      ) : null}
      {archived.length > 0 ? (
        <section aria-labelledby="archived-heading" className="flex flex-col gap-2">
          <h2 id="archived-heading" className="text-xl font-semibold">
            Archived
          </h2>
          <ul className="rounded-lg border border-border bg-surface px-5">
            {archived.map((c) => (
              <CourseRow key={c.id} c={c} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
