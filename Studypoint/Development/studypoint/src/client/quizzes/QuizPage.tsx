// Taking a practice quiz (QZ-01..04): answer every question, then Submit. Multiple choice, true/false and
// numeric answers are graded instantly on this device; short answers are graded by the AI against the
// model answer and rubric, with feedback. Every question shows its explanation and where it came from.

import { useEffect, useState } from 'react';
import { Button, RadioGroup, TextArea, TextField, useToast } from '../ds/index.ts';
import { Link } from '../Link.tsx';
import { gradeDeterministic, type QuizQuestion } from '../../shared/aiOutput.ts';
import { MathText } from '../cards/MathText.tsx';
import { gradeShort } from '../ai/aiApi.ts';
import { fetchQuiz, submitQuiz, type Answered, type Quiz } from './quizApi.ts';

type Result = { score: number; feedback: string | null };

/** Where a question's answer comes from: your material, or (plan tests) a trusted web page, linked. */
function QuoteSource({ q }: { q: QuizQuestion & { source?: { title: string; url?: string } } }) {
  const src = q.source;
  if (src?.url) {
    return (
      <span className="text-text-3">
        From <a href={src.url} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2">{src.title}</a>: “{q.quote}”
      </span>
    );
  }
  return <span className="text-text-3">From your material: “{q.quote}”</span>;
}

function Question({ n, q, value, onChange, result }: { n: number; q: QuizQuestion; value: unknown; onChange: (v: unknown) => void; result: Result | null }) {
  const locked = result !== null;
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
      <p className="text-text">
        <span className="mr-2 font-mono text-sm text-text-3">{n}.</span>
        <MathText text={q.stem} />
      </p>
      {q.format === 'mcq' ? (
        <RadioGroup
          label={`Answer for question ${n}`}
          value={typeof value === 'number' ? String(value) : null}
          options={q.options.map((o, i) => ({ value: String(i), label: o }))}
          onChange={(v) => !locked && onChange(Number(v))}
        />
      ) : q.format === 'tf' ? (
        <RadioGroup label={`Answer for question ${n}`} value={value === true ? 'true' : value === false ? 'false' : null} options={[{ value: 'true', label: 'True' }, { value: 'false', label: 'False' }]} onChange={(v) => !locked && onChange(v === 'true')} />
      ) : q.format === 'numeric' ? (
        <div className="max-w-xs">
          <TextField label={`Answer${q.units ? ` (${q.units})` : ''}`} inputMode="decimal" value={typeof value === 'string' ? value : ''} onChange={(e) => !locked && onChange(e.target.value)} disabled={locked} />
        </div>
      ) : (
        <TextArea label="Your answer" value={typeof value === 'string' ? value : ''} onChange={(e) => !locked && onChange(e.target.value)} disabled={locked} rows={4} />
      )}
      {result ? (
        <div className={`flex flex-col gap-1 rounded-md p-3 text-sm ${result.score >= 0.99 ? 'bg-sunken' : 'border border-danger bg-surface'}`} role="status">
          <span className={result.score >= 0.99 ? 'font-semibold text-text' : 'font-semibold text-danger'}>
            {result.score >= 0.99 ? '✓ Correct' : result.score > 0 ? `Partly right (${Math.round(result.score * 100)}%)` : '✗ Not quite'}
          </span>
          {q.format === 'mcq' ? <span>Answer: <MathText text={q.options[q.correct] ?? ''} /></span> : null}
          {q.format === 'tf' ? <span>Answer: {q.answer ? 'True' : 'False'}</span> : null}
          {q.format === 'numeric' ? <span>Answer: {q.value} {q.units} (±{q.tolerance})</span> : null}
          {q.format === 'short' ? <span>Model answer: <MathText text={q.answer} /></span> : null}
          {result.feedback ? <span className="text-text-2">{result.feedback}</span> : null}
          {q.explanation ? <span className="text-text-2"><MathText text={q.explanation} /></span> : null}
          {q.quote ? <QuoteSource q={q} /> : null}
        </div>
      ) : null}
    </li>
  );
}

export default function QuizPage({ id }: { id: string }) {
  const toast = useToast();
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [results, setResults] = useState<Record<string, Result> | null>(null);
  const [grading, setGrading] = useState(false);
  const [started] = useState(Date.now());

  useEffect(() => {
    fetchQuiz(id).then(setQuiz, (e) => setError(e instanceof Error ? e.message : 'This quiz couldn’t be opened.'));
  }, [id]);

  const submit = async () => {
    if (!quiz) return;
    setGrading(true);
    const out: Record<string, Result> = {};
    const records: Answered[] = [];
    const each = Math.round((Date.now() - started) / Math.max(1, quiz.questions.length));
    for (const item of quiz.questions) {
      const q = item.question;
      if (!q) continue;
      const response = answers[item.id];
      let auto = gradeDeterministic(q, response);
      let ai: number | null = null;
      let feedback: string | null = null;
      if (auto === null) {
        const text = typeof response === 'string' ? response.trim() : '';
        if (!text) auto = 0;
        else {
          try {
            const g = await gradeShort(q.stem, q.format === 'short' ? q.answer : '', q.format === 'short' ? q.rubric : [], text);
            ai = g.score;
            feedback = g.feedback;
          } catch (e) {
            feedback = e instanceof Error ? `Couldn’t grade automatically: ${e.message}` : 'Couldn’t grade automatically.';
            ai = 0;
          }
        }
      }
      const final = auto ?? ai ?? 0;
      out[item.id] = { score: final, feedback };
      records.push({ questionId: item.id, response: response ?? null, autoScore: auto, aiScore: ai, finalScore: final, durationMs: each });
    }
    setResults(out);
    try {
      const score = await submitQuiz(quiz.id, records);
      toast.show({ message: `Score: ${Math.round(score * 100)}%` });
      // Step 6b: if this is a study plan's test or mini-quiz, update the topic scores and the plan.
      void import('../plans/planBuilder.ts')
        .then((m) => m.recordQuizInPlan(quiz, records))
        .then(() => import('../plans/planJobs.ts'))
        .then((m) => m.kickPlansSoon())
        .catch(() => toast.show({ message: 'Your study plan couldn’t be updated from this quiz. Try reloading.', tone: 'error' }));
    } catch (e) {
      toast.show({ message: e instanceof Error ? `Your score couldn’t be saved: ${e.message}` : 'Your score couldn’t be saved.', tone: 'error' });
    } finally {
      setGrading(false);
    }
  };

  if (error) return <p className="text-danger">{error}</p>;
  if (!quiz) return <p className="text-text-2">Decrypting the quiz…</p>;
  const answeredAll = quiz.questions.every((q) => answers[q.id] !== undefined && answers[q.id] !== '');
  const total = results ? quiz.questions.reduce((n, q) => n + (results[q.id]?.score ?? 0), 0) / Math.max(1, quiz.questions.length) : null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link to={`/courses/${quiz.courseId}?tab=quizzes`} className="text-sm text-text-2 hover:text-accent">← Quizzes</Link>
        <h1 className="text-[2.125rem] leading-tight font-semibold">{quiz.title}</h1>
        <p className="text-sm text-text-2">{quiz.count} questions · {quiz.questions.some((x) => (x.question as { source?: { url?: string } } | null)?.source?.url) ? 'AI-made from trusted web pages' : 'AI-made from your material'}, checked before saving</p>
      </div>
      <ol className="flex flex-col gap-4">
        {quiz.questions.map((item, i) =>
          item.question ? (
            <Question key={item.id} n={i + 1} q={item.question} value={answers[item.id]} onChange={(v) => setAnswers((a) => ({ ...a, [item.id]: v }))} result={results?.[item.id] ?? null} />
          ) : (
            <li key={item.id} className="text-danger">This question can’t be decrypted.</li>
          ),
        )}
      </ol>
      {results ? (
        <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-surface p-5">
          <p className="text-2xl font-semibold text-text">{Math.round((total ?? 0) * 100)}%</p>
          <Button onClick={() => { setResults(null); setAnswers({}); }}>Try again</Button>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <Button variant="primary" loading={grading} onClick={() => void submit()} disabled={!answeredAll}>Submit and grade</Button>
          {!answeredAll ? <span className="text-sm text-text-2">Answer every question to submit.</span> : null}
        </div>
      )}
    </div>
  );
}
