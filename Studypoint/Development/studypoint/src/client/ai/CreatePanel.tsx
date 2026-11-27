// Create (step 5): AI-made course materials from YOUR files, links and notes.
// • Plan: reads the course's material (a syllabus or schedule sets the topics and order) and proposes
//   topics with the materials that would help; tick what you want and make it.
// • Or make one thing: a study guide (short article, with a diagram where it helps), a diagram, flashcards
//   or a practice quiz, about any topic.
// Cards and quiz questions are checked (quote found in your material, format rules, a second model agrees)
// before you see them; you choose which cards to keep.

import { useEffect, useState } from 'react';
import { Button, Checkbox, SegmentedControl, Select, Slider, TextField, useToast } from '../ds/index.ts';
import { Link } from '../Link.tsx';
import type { PlanTopic, QuizQuestion } from '../../shared/aiOutput.ts';
import { MathText } from '../cards/MathText.tsx';
import { createCard } from '../cards/cardsApi.ts';
import { uploadFile } from '../files/filesApi.ts';
import { MarkdownView } from '../reader/MarkdownView.tsx';
import { saveQuiz } from '../quizzes/quizApi.ts';
import { useStudy } from '../studyStore.ts';
import { generatePlan } from './aiApi.ts';
import { courseOutline, makeArticle, makeCards, makeDiagram, makeQuiz, passagesFor, type ReviewedCards } from './create.ts';
import { loadCourseIndex, type CourseIndex } from './indexer.ts';
import { ProcessPanel } from './ProcessPanel.tsx';

type Kind = 'article' | 'diagram' | 'cards' | 'quiz';
const KIND_LABEL: Record<Kind, string> = { article: 'Study guide', diagram: 'Diagram', cards: 'Flashcards', quiz: 'Practice quiz' };

type Result =
  | { id: number; kind: 'article' | 'diagram'; topic: string; title: string; markdown: string; saved: boolean }
  | { id: number; kind: 'cards'; topic: string; review: ReviewedCards; keep: boolean[]; saved: boolean }
  | { id: number; kind: 'quiz'; topic: string; accepted: QuizQuestion[]; rejected: Array<{ item: QuizQuestion; reasons: string[] }>; quizId: string | null }
  | { id: number; kind: 'error'; topic: string; message: string };

let nextId = 1;

function CardsResult({ r, courseId, onSaved }: { r: Extract<Result, { kind: 'cards' }>; courseId: string; onSaved: (keep: boolean[]) => void }) {
  const toast = useToast();
  const [keep, setKeep] = useState(r.keep);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    let n = 0;
    for (const [i, a] of r.review.accepted.entries()) {
      if (!keep[i]) continue;
      try {
        await createCard(courseId, a.payload);
        n += 1;
      } catch {
        // keep going; the count tells the story
      }
    }
    setSaving(false);
    toast.show({ message: `${n} card${n === 1 ? '' : 's'} added to this course` });
    onSaved(keep);
  };
  return (
    <div className="flex flex-col gap-3">
      {r.review.accepted.length === 0 ? <p className="text-text-2">No cards passed the checks.</p> : (
        <ul className="flex flex-col gap-2">
          {r.review.accepted.map((a, i) => (
            <li key={i} className="flex gap-3 rounded-md border border-border p-3">
              <Checkbox checked={keep[i] ?? false} onChange={(v) => setKeep((k) => k.map((x, j) => (j === i ? v : x)))} label={`Keep card ${i + 1}`} disabled={r.saved} />
              <div className="flex min-w-0 flex-col gap-1 text-sm">
                {a.card.kind === 'cloze' ? <MathText text={a.card.text.replace(/\{\{c\d+::((?:[^{}]|\{[^{}]*\})*?)(?:::[^{}]*)?\}\}/g, '[$1]')} /> : (
                  <>
                    <span className="text-text"><MathText text={a.card.front} /></span>
                    <span className="text-text-2">→ <MathText text={a.card.back} /></span>
                  </>
                )}
                <span className="text-xs text-text-3">{a.card.kind === 'typed' ? 'Typed answer · ' : a.card.kind === 'cloze' ? 'Fill in the blank · ' : ''}“{a.card.quote}” [{a.card.ref}]</span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {r.review.rejected.length > 0 ? (
        <details className="text-sm text-text-2">
          <summary className="cursor-pointer">{r.review.rejected.length} rejected by the checks (why)</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {r.review.rejected.map((x, i) => (
              <li key={i}>{x.card.kind === 'cloze' ? x.card.text : x.card.front}: <span className="text-danger">{x.reasons.join('; ')}</span></li>
            ))}
          </ul>
        </details>
      ) : null}
      {r.review.accepted.length > 0 ? (
        <div><Button variant="primary" loading={saving} disabled={r.saved || !keep.some(Boolean)} onClick={() => void save()}>{r.saved ? 'Added' : `Add ${keep.filter(Boolean).length} to my cards`}</Button></div>
      ) : null}
    </div>
  );
}

export function CreatePanel({ courseId }: { courseId: string }) {
  const toast = useToast();
  const { courses } = useStudy();
  const course = courses.find((c) => c.id === courseId);
  const [index, setIndex] = useState<CourseIndex | null>(null);
  const [checks, setChecks] = useState(0);
  const [plan, setPlan] = useState<Array<PlanTopic & { pick: Kind[] }> | null>(null);
  const [planIds, setPlanIds] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  // One-off maker
  const [kind, setKind] = useState<Kind>('article');
  const [topic, setTopic] = useState('');
  const [count, setCount] = useState(10);
  const [difficulty, setDifficulty] = useState('3');
  const [length, setLength] = useState<'short' | 'medium'>('short');

  useEffect(() => {
    loadCourseIndex(courseId).then(setIndex, () => setIndex(null));
  }, [courseId, checks]);

  const ready = Boolean(index && index.passages.length > 0);

  const make = async (k: Kind, t: string, sourceIds: string[] = []) => {
    if (!index) return;
    setBusy(`Making ${KIND_LABEL[k].toLowerCase()}: ${t}`);
    try {
      const tp = await passagesFor(index, t, sourceIds, k === 'article' ? 12 : 10);
      if (k === 'article' || k === 'diagram') {
        const out = k === 'article' ? await makeArticle(tp, t, length) : await makeDiagram(tp, t);
        setResults((r) => [{ id: nextId++, kind: k, topic: t, title: out.title, markdown: out.markdown, saved: false }, ...r]);
      } else if (k === 'cards') {
        const review = await makeCards(tp, t, count, ['basic', 'cloze', 'typed']);
        setResults((r) => [{ id: nextId++, kind: 'cards', topic: t, review, keep: review.accepted.map(() => true), saved: false }, ...r]);
      } else {
        const q = await makeQuiz(tp, t, Math.min(count, 15), ['mcq', 'tf', 'numeric', 'short'], Number(difficulty));
        const quizId = q.accepted.length ? await saveQuiz(courseId, `Quiz: ${t}`, q.accepted) : null;
        setResults((r) => [{ id: nextId++, kind: 'quiz', topic: t, accepted: q.accepted, rejected: q.rejected, quizId }, ...r]);
      }
    } catch (e) {
      setResults((r) => [{ id: nextId++, kind: 'error', topic: t, message: e instanceof Error ? e.message : 'Something went wrong.' }, ...r]);
    } finally {
      setBusy(null);
    }
  };

  const runPlan = async () => {
    if (!index) return;
    setBusy('Reading your material to plan topics…');
    try {
      const { outline, ids } = courseOutline(index);
      const { topics } = await generatePlan(outline, course?.name ?? 'this course');
      setPlanIds(ids);
      setPlan(topics.map((t) => ({ ...t, pick: t.make.length ? t.make : ['article', 'cards'] })));
    } catch (e) {
      toast.show({ message: e instanceof Error ? e.message : 'Couldn’t make a plan.', tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const makeSelected = async () => {
    if (!plan) return;
    for (const t of plan) {
      const sources = t.sourceIds.map((s) => planIds.get(s)).filter((x): x is string => Boolean(x));
      for (const k of t.pick) await make(k, t.title, sources);
    }
  };

  const saveDoc = async (r: Extract<Result, { kind: 'article' | 'diagram' }>) => {
    try {
      const name = `${r.kind === 'article' ? 'Study guide' : 'Diagram'} · ${r.title}`.replace(/[\\/:*?"<>|]/g, ' ').slice(0, 120);
      await uploadFile(new File([r.markdown], `${name}.md`, { type: 'text/markdown' }), courseId, undefined, 'ai');
      setResults((all) => all.map((x) => (x.id === r.id ? { ...r, saved: true } : x)));
      toast.show({ message: 'Saved to this course’s files' });
    } catch (e) {
      toast.show({ message: e instanceof Error ? e.message : 'Couldn’t save it.', tone: 'error' });
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <ProcessPanel courseId={courseId} onChecked={() => setChecks((n) => n + 1)} />

      <section aria-labelledby="plan-heading" className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
        <h2 id="plan-heading" className="text-lg font-semibold">Plan from my material</h2>
        <p className="text-sm text-text-2">Studyflare reads everything in this course (a syllabus or schedule tells it the topics and their order) and suggests what to make for each topic.</p>
        <div><Button variant="primary" disabled={!ready || busy !== null} onClick={() => void runPlan()}>Suggest a plan</Button></div>
        {plan ? (
          <div className="flex flex-col gap-3">
            <ol className="flex flex-col gap-3">
              {plan.map((t, i) => (
                <li key={i} className="flex flex-col gap-2 rounded-md border border-border p-3">
                  <span className="font-semibold text-text">{i + 1}. {t.title}</span>
                  <span className="text-sm text-text-2">{t.summary}</span>
                  <div className="flex flex-wrap gap-4">
                    {(['article', 'diagram', 'cards', 'quiz'] as const).map((k) => (
                      <Checkbox key={k} label={KIND_LABEL[k]} checked={t.pick.includes(k)} onChange={(on) => setPlan((p) => (p ? p.map((x, j) => (j === i ? { ...x, pick: on ? [...x.pick, k] : x.pick.filter((y) => y !== k) } : x)) : p))} />
                    ))}
                  </div>
                </li>
              ))}
            </ol>
            <div><Button variant="primary" disabled={busy !== null} onClick={() => void makeSelected()}>Make everything ticked</Button></div>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="one-heading" className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
        <h2 id="one-heading" className="text-lg font-semibold">Make one thing</h2>
        <SegmentedControl label="What" value={kind} options={(['article', 'diagram', 'cards', 'quiz'] as const).map((k) => ({ value: k, label: KIND_LABEL[k] }))} onChange={setKind} />
        <TextField label="Topic" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Fourier’s law and thermal resistance" />
        {kind === 'cards' || kind === 'quiz' ? <Slider label={kind === 'cards' ? 'How many cards' : 'How many questions'} min={3} max={kind === 'cards' ? 30 : 15} step={1} value={Math.min(count, kind === 'cards' ? 30 : 15)} onChange={setCount} /> : null}
        {kind === 'quiz' ? (
          <div className="max-w-xs"><Select label="Difficulty" value={difficulty} options={[{ value: '1', label: '1 · recall' }, { value: '2', label: '2' }, { value: '3', label: '3 · apply' }, { value: '4', label: '4' }, { value: '5', label: '5 · exam-hard' }]} onChange={setDifficulty} /></div>
        ) : null}
        {kind === 'article' ? <SegmentedControl label="Length" value={length} options={[{ value: 'short', label: 'Short (~400 words)' }, { value: 'medium', label: 'Longer (~900 words)' }]} onChange={setLength} /> : null}
        <div><Button variant="primary" disabled={!ready || !topic.trim() || busy !== null} onClick={() => void make(kind, topic.trim())}>Make it</Button></div>
      </section>

      {busy ? <p className="text-text-2" aria-live="polite">{busy}…</p> : null}

      <div className="flex flex-col gap-5" aria-live="polite">
        {results.map((r) => (
          <article key={r.id} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
            <h3 className="font-semibold text-text">{r.kind === 'error' ? 'Couldn’t make it' : KIND_LABEL[r.kind]}: {r.topic}</h3>
            {r.kind === 'error' ? <p className="text-danger">{r.message}</p> : null}
            {r.kind === 'article' || r.kind === 'diagram' ? (
              <>
                <div className="max-h-[32rem] overflow-y-auto rounded-md border border-dashed border-border-strong p-4"><MarkdownView text={r.markdown} /></div>
                <div><Button variant="primary" disabled={r.saved} onClick={() => void saveDoc(r)}>{r.saved ? 'Saved to Files' : 'Save to course files'}</Button></div>
              </>
            ) : null}
            {r.kind === 'cards' ? <CardsResult r={r} courseId={courseId} onSaved={(keep) => setResults((all) => all.map((x) => (x.id === r.id ? { ...r, keep, saved: true } : x)))} /> : null}
            {r.kind === 'quiz' ? (
              <>
                <p className="text-text">
                  {r.accepted.length} question{r.accepted.length === 1 ? '' : 's'} passed the checks
                  {r.quizId ? <> and {r.accepted.length === 1 ? 'was' : 'were'} saved. <Link to={`/quizzes/${r.quizId}`} className="text-accent underline underline-offset-2">Take the quiz</Link></> : '.'}
                </p>
                {r.rejected.length ? (
                  <details className="text-sm text-text-2">
                    <summary className="cursor-pointer">{r.rejected.length} rejected (why)</summary>
                    <ul className="mt-2 flex flex-col gap-1">{r.rejected.map((x, i) => <li key={i}>{x.item.stem}: <span className="text-danger">{x.reasons.join('; ')}</span></li>)}</ul>
                  </details>
                ) : null}
              </>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  );
}
