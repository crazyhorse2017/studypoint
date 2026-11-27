// Add a course (INS-02, DESIGN §6 first run). By code + title now; the automatic catalog lookup arrives in P2.
// Step 6b: adding a course starts its study plan: a practice test is made in the background from trusted
// websites about it, and the plan is built from your score.

import { useMemo, useState } from 'react';
import { Button, SegmentedControl, TextField } from '../ds/index.ts';
import { checkCourseCode, learnFormat } from '../../shared/courseCode.ts';
import { addCourse, useStudy } from '../studyStore.ts';
import { Link } from '../Link.tsx';
import { startPlan } from '../plans/planApi.ts';
import { kickPlansSoon } from '../plans/planJobs.ts';

type Kind = 'college' | 'personal';

export function AddCourse({ onAdded }: { onAdded?: () => void }) {
  const { courses, school } = useStudy();
  // Without a school yet, only personal subjects can be added, so start there.
  const [kind, setKind] = useState<Kind>(school ? 'college' : 'personal');
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const format = useMemo(
    () => learnFormat(courses.filter((c) => c.school !== null && c.school.name === school?.name && c.code).map((c) => c.code as string)),
    [courses, school],
  );
  const check = kind === 'college' && code.trim() ? checkCourseCode(code, format) : null;
  const codeError = check && !check.ok ? check.error : null;
  const codeHint = check && check.ok ? (check.warning ?? `Saved as ${check.code.normalised}`) : 'Letters, then a number, like SUBJ 101.';

  const submit = async () => {
    setError(null);
    if (kind === 'personal') {
      if (!title.trim()) return setError('Name the subject, like “Astronomy” or “Learning Italian”.');
    } else {
      if (codeError) return;
      if (!code.trim() && !title.trim()) return setError('Enter a course code, a title, or both.');
    }
    setSaving(true);
    try {
      const course = await addCourse({ kind, code: kind === 'personal' ? '' : code, title });
      // The practice test is made in the background; a failure here just means no plan yet.
      void startPlan(course.id, course.name).then(kickPlansSoon, () => undefined);
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
        <SegmentedControl
          label="Type"
          value={kind}
          options={[
            { value: 'college', label: 'College course' },
            { value: 'personal', label: 'Personal subject' },
          ]}
          onChange={(k) => {
            setKind(k);
            setError(null);
          }}
        />
        {kind === 'personal' ? (
          <TextField
            label="Subject name"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Astronomy, Learning Italian, Guitar theory"
            description="Something you’re learning for yourself. No school or course code needed."
          />
        ) : !school ? (
          <p className="text-text-2">
            <Link to="/" className="text-accent underline underline-offset-2">
              Choose your school on Today
            </Link>{' '}
            to add college courses, or add a personal subject instead.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
            <TextField label="Course code" value={code} onChange={(e) => setCode(e.target.value)} error={codeError} description={codeError ? undefined : codeHint} placeholder="SUBJ 101" autoCapitalize="characters" />
            <TextField label="Course title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="As it appears in your catalog" />
          </div>
        )}
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <div>
          <Button type="submit" variant="primary" loading={saving} disabled={kind === 'college' && !school}>
            {kind === 'personal' ? 'Add subject' : 'Add course'}
          </Button>
        </div>
      </form>

      <p className="border-t border-border pt-4 text-sm text-text-2">
        Once it’s added, Studyflare makes a <strong className="text-text">20-question practice test</strong> from trusted websites about the course, in the background. Take it from the course’s Plan tab and you get a day-by-day study plan built around what you missed. Add your own files any time: the plan uses them once they’re processed.
      </p>
    </div>
  );
}
