// One course (or personal subject): Overview, Files, Notes and Cards, each in its own tab. The tab is kept
// in the URL (?tab=cards), so a reload or a link opens the same place.

import { useEffect, useState } from 'react';
import { Tabs } from '../ds/index.ts';
import { Link } from '../Link.tsx';
import { navigate, useLocation } from '../router.ts';
import { useStudy } from '../studyStore.ts';
import { FilesSection } from '../files/FilesSection.tsx';
import { NotesSection } from '../notes/NotesSection.tsx';
import { CardsSection } from '../cards/CardsSection.tsx';
import { fetchStudySettings, fetchSummary, type Summary } from '../cards/cardsApi.ts';
import { ExamDate } from './ExamDate.tsx';
import { QuizzesSection } from '../quizzes/QuizzesSection.tsx';
import { AskPanel } from '../ai/AskPanel.tsx';
import { CreatePanel } from '../ai/CreatePanel.tsx';

type Tab = 'overview' | 'files' | 'notes' | 'cards' | 'quizzes' | 'ask' | 'create';
const TABS: readonly Tab[] = ['overview', 'files', 'notes', 'cards', 'quizzes', 'ask', 'create'];

const fmtDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

function Overview({ courseId }: { courseId: string }) {
  const [examAt, setExamAt] = useState<number | null | undefined>(undefined);
  const [summary, setSummary] = useState<Summary | null>(null);
  useEffect(() => {
    fetchStudySettings().then((r) => setExamAt(r.exams.find((e) => e.courseId === courseId)?.at ?? null), () => setExamAt(null));
    fetchSummary().then(setSummary, () => setSummary(null));
  }, [courseId]);
  const exam = summary?.exams.find((e) => e.courseId === courseId);

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="study-heading" className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
        <h2 id="study-heading" className="text-lg font-semibold">
          Study
        </h2>
        <div className="flex flex-wrap gap-3">
          <Link to={`/review?course=${encodeURIComponent(courseId)}`} className="inline-flex min-h-10 items-center rounded-md bg-accent px-4 font-semibold text-on-accent hover:opacity-90">
            Review this course
          </Link>
          <Link to={`/courses/${courseId}?tab=cards`} className="inline-flex min-h-10 items-center rounded-md border border-border-strong px-4 text-text hover:bg-sunken">
            Make cards
          </Link>
          <Link to={`/courses/${courseId}?tab=ask`} className="inline-flex min-h-10 items-center rounded-md border border-border-strong px-4 text-text hover:bg-sunken">
            Ask a question
          </Link>
          <Link to={`/courses/${courseId}?tab=create`} className="inline-flex min-h-10 items-center rounded-md border border-border-strong px-4 text-text hover:bg-sunken">
            Create study materials
          </Link>
        </div>
      </section>

      <section aria-labelledby="exam-heading" className="flex flex-col gap-3">
        <h2 id="exam-heading" className="text-lg font-semibold">
          Exam
        </h2>
        {examAt ? (
          <p className="text-text">
            Exam on <strong>{fmtDate(examAt)}</strong>.{' '}
            {exam ? (exam.onTrack ? 'You’re on track to see every card before it.' : `${exam.unseen} cards haven’t been seen yet; new cards are being front-loaded.`) : null}
          </p>
        ) : (
          <p className="text-text-2">Set an exam date and Studyflare switches this course to exam mode: every card is reviewed at least once more before the exam, and new cards come first.</p>
        )}
        {examAt !== undefined ? <ExamDate key={String(examAt)} courseId={courseId} examAt={examAt} onChanged={setExamAt} /> : null}
      </section>
    </div>
  );
}

export default function CoursePage({ id }: { id: string }) {
  const { courses, loaded } = useStudy();
  const { search } = useLocation();
  const raw = search.get('tab');
  const tab: Tab = (TABS as readonly string[]).includes(raw ?? '') ? (raw as Tab) : 'overview';
  const course = courses.find((c) => c.id === id);

  if (!loaded) return <p className="text-text-2">Loading…</p>;
  if (!course) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        <h1 className="text-[2.125rem] leading-tight font-semibold">Course not found</h1>
        <Link to="/library" className="text-accent underline underline-offset-2">Back to Library</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link to="/library" className="text-sm text-text-2 hover:text-accent">← Library</Link>
        <h1 className="flex flex-wrap items-baseline gap-3 text-[2.125rem] leading-tight font-semibold">
          {course.code ? <span className="font-mono text-2xl text-text-2">{course.code}</span> : null}
          <span>{course.name}</span>
        </h1>
        <p className="text-sm text-text-2">
          {course.school ? course.school.name : 'Personal subject'}
          {course.archived ? ' · archived' : ''}
        </p>
      </div>
      <Tabs
        label="Course sections"
        value={tab}
        onChange={(t) => navigate(`/courses/${id}${t === 'overview' ? '' : `?tab=${t}`}`, { replace: true })}
        tabs={[
          { value: 'overview', label: 'Overview', panel: <Overview courseId={id} /> },
          { value: 'files', label: 'Files', panel: <FilesSection course={id} /> },
          { value: 'notes', label: 'Notes', panel: <NotesSection course={id} /> },
          { value: 'cards', label: 'Cards', panel: <CardsSection courseId={id} /> },
          { value: 'quizzes', label: 'Quizzes', panel: <QuizzesSection courseId={id} /> },
          { value: 'ask', label: 'Ask', panel: <AskPanel courseId={id} /> },
          { value: 'create', label: 'Create', panel: <CreatePanel courseId={id} /> },
        ]}
      />
    </div>
  );
}
