// Add a course (INS-02, DESIGN §6 first run). By code + title now; the automatic catalog lookup arrives in P2.
// The other ways to start a course say plainly what they're waiting for.

import { useMemo, useState } from 'react';
import { Button, TextField } from '../ds/index.ts';
import { checkCourseCode, learnFormat } from '../../shared/courseCode.ts';
import { addCourse, useStudy } from '../studyStore.ts';

export function AddCourse({ onAdded }: { onAdded?: () => void }) {
  const { courses, school } = useStudy();
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const format = useMemo(
    () => learnFormat(courses.filter((c) => c.school.name === school?.name && c.code).map((c) => c.code as string)),
    [courses, school],
  );
  const check = code.trim() ? checkCourseCode(code, format) : null;
  const codeError = check && !check.ok ? check.error : null;
  const codeHint = check && check.ok ? (check.warning ?? `Saved as ${check.code.normalised}`) : 'Letters, then a number, like SUBJ 101.';

  const submit = async () => {
    setError(null);
    if (codeError) return;
    if (!code.trim() && !title.trim()) {
      setError('Enter a course code, a title, or both.');
      return;
    }
    setSaving(true);
    try {
      await addCourse({ code, title });
      setCode('');
      setTitle('');
      onAdded?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
          <TextField label="Course code" value={code} onChange={(e) => setCode(e.target.value)} error={codeError} description={codeError ? undefined : codeHint} placeholder="SUBJ 101" autoCapitalize="characters" />
          <TextField label="Course title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="As it appears in your catalog" />
        </div>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <div>
          <Button type="submit" variant="primary" loading={saving}>
            Add course
          </Button>
        </div>
      </form>

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <p className="text-sm font-semibold text-text-2">Other ways to add course material</p>
        <ul className="grid gap-2 text-sm text-text-2 sm:grid-cols-3">
          <li className="rounded-md border border-dashed border-border-strong p-3">
            <span className="block text-text">Upload files</span>
            PDFs, slides and notes. Turns on once file storage is enabled (Workers Paid).
          </li>
          <li className="rounded-md border border-dashed border-border-strong p-3">
            <span className="block text-text">Paste a link</span>
            Needs file storage and AI reading, enabled with Workers Paid.
          </li>
          <li className="rounded-md border border-dashed border-border-strong p-3">
            <span className="block text-text">Look up a topic</span>
            Trusted-source search, plus automatic catalog lookup by code, arrives in the next phase.
          </li>
        </ul>
      </div>
    </div>
  );
}
