// A course's practice quizzes: take one, see your last score, or remove it. New quizzes are made in Create.

import { useCallback, useEffect, useState } from 'react';
import { Button, useToast } from '../ds/index.ts';
import { Link } from '../Link.tsx';
import { fetchQuizzes, hideQuiz, type QuizSummary } from './quizApi.ts';

export function QuizzesSection({ courseId }: { courseId: string }) {
  const toast = useToast();
  const [quizzes, setQuizzes] = useState<QuizSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => {
    fetchQuizzes(courseId).then(setQuizzes, (e) => setError(e instanceof Error ? e.message : 'Your quizzes couldn’t be loaded.'));
  }, [courseId]);
  useEffect(refresh, [refresh]);

  return (
    <section aria-labelledby="quizzes-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="quizzes-heading" className="text-xl font-semibold">Practice quizzes</h2>
          <p className="text-sm text-text-2">Auto-graded. Made by AI from your material in the Create tab, and checked before they’re saved.</p>
        </div>
        <Link to={`/courses/${courseId}?tab=create`} className="inline-flex min-h-10 items-center rounded-md bg-accent px-4 font-semibold text-on-accent hover:opacity-90">Make a quiz</Link>
      </div>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {quizzes === null && !error ? <p className="text-text-2">Decrypting your quizzes…</p> : null}
      {quizzes?.length === 0 ? <p className="rounded-lg border border-dashed border-border-strong p-5 text-text-2">No quizzes yet.</p> : null}
      {quizzes && quizzes.length > 0 ? (
        <ul className="rounded-lg border border-border bg-surface px-5">
          {quizzes.map((q) => (
            <li key={q.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-3 last:border-0">
              <Link to={`/quizzes/${q.id}`} className="flex flex-col hover:text-accent">
                <span className="text-text">{q.title}</span>
                <span className="text-sm text-text-3">{q.count} questions{q.score !== null ? ` · last score ${Math.round(q.score * 100)}%` : ' · not taken yet'}</span>
              </Link>
              <Button size="sm" variant="ghost" aria-label={`Remove ${q.title}`} onClick={() => void hideQuiz(q.id).then(() => { refresh(); toast.show({ message: 'Quiz removed' }); }, () => toast.show({ message: 'Couldn’t remove it.', tone: 'error' }))}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
