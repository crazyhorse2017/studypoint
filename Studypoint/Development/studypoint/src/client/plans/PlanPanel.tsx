// A course's study plan (step 6b, A26): the practice test while it's being made, then the topic scores and
// the day-by-day plan built from them. Scores are shown as a number and a word, never colour alone.

import { useEffect, useState, type ReactNode } from 'react';
import { Button, Checkbox, ConfirmDialog, useToast } from '../ds/index.ts';
import { Link } from '../Link.tsx';
import { MathText } from '../cards/MathText.tsx';
import { dayKey, isWeak, WEAK, type PlanDay, type PlanTask, type PlanTopic, type StudyPlan, type TopicMaterials } from '../../shared/studyPlan.ts';
import { deletePlan, fetchPlan, startPlan, type LoadedPlan } from './planApi.ts';
import { kickPlansSoon, usePlanJob, usePlanVersion } from './planJobs.ts';

const pct = (s: number | null) => (s === null ? '—' : `${Math.round(s * 100)}%`);
const level = (s: number | null) => (s === null ? 'Not tested yet' : s < 0.5 ? 'Needs work' : s < WEAK ? 'Getting there' : s < 0.9 ? 'Good' : 'Strong');
const fmtDay = (day: string, today: string) => {
  if (day === today) return 'Today';
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
};

function ScoreBar({ t }: { t: PlanTopic }) {
  const s = t.score ?? 0;
  return (
    <li className="flex flex-col gap-1">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium text-text">{t.title}</span>
        <span className="text-sm text-text-2">
          <strong className="text-text">{pct(t.score)}</strong> · {level(t.score)}
          {isWeak(t) ? ' · in your plan' : ''}
        </span>
      </div>
      <span aria-hidden="true" className="block h-2 overflow-hidden rounded-full bg-sunken">
        <span className={`block h-full ${isWeak(t) ? 'bg-danger' : 'bg-accent'}`} style={{ width: `${Math.max(3, s * 100)}%` }} />
      </span>
    </li>
  );
}

function Tray({ courseId, topicId, m, onDone }: { courseId: string; topicId: string; m: TopicMaterials; onDone: () => void }) {
  const toast = useToast();
  const tray = m.tray ?? [];
  const [keep, setKeep] = useState<Set<number>>(() => new Set(tray.map((_, i) => i)));
  const [busy, setBusy] = useState(false);
  if (tray.length === 0) return null;
  const approve = async (chosen: number[]) => {
    setBusy(true);
    try {
      const { approveTray } = await import('./planBuilder.ts');
      const n = await approveTray(courseId, topicId, chosen, true);
      toast.show({ message: n ? `Added ${n} card${n === 1 ? '' : 's'} to this course` : 'Cards discarded' });
      onDone();
    } catch (e) {
      toast.show({ message: e instanceof Error ? e.message : 'Couldn’t add the cards.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3">
      <p className="text-sm text-text-2">{tray.length} cards made and checked against their sources. Keep the ones you want:</p>
      <ul className="flex flex-col gap-2">
        {tray.map((c, i) => (
          <li key={i} className="flex items-start gap-3 rounded-md bg-sunken p-2">
            <Checkbox
              label={`Keep card ${i + 1}`}
              checked={keep.has(i)}
              onChange={(on) => setKeep((k) => {
                const n = new Set(k);
                if (on) n.add(i);
                else n.delete(i);
                return n;
              })}
            />
            <span className="flex flex-col text-sm">
              {c.kind === 'cloze' ? <MathText text={(c.text ?? '').replace(/\{\{c\d+::([^}]*)\}\}/g, '[$1]')} /> : (
                <>
                  <span className="font-medium text-text"><MathText text={c.front} /></span>
                  <span className="text-text-2"><MathText text={c.back} /></span>
                </>
              )}
              {c.source ? <span className="text-xs text-text-3">{c.source}</span> : null}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="primary" loading={busy} disabled={keep.size === 0} onClick={() => void approve([...keep])}>Add {keep.size} to my cards</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void approve([])}>Discard all</Button>
      </div>
    </div>
  );
}

function TaskRow({ task, plan, courseId, day, today, onChange }: { task: PlanTask; plan: StudyPlan; courseId: string; day: string; today: string; onChange: () => void }) {
  const topic = plan.topics.find((t) => t.id === task.topicId);
  const m: TopicMaterials = (task.topicId ? plan.materials[task.topicId] : undefined) ?? {};
  const making = <span className="text-sm text-text-3">Being made in the background…</span>;
  const mark = async (done: boolean) => {
    const { setTaskDone } = await import('./planBuilder.ts');
    await setTaskDone(courseId, day, task.kind, task.topicId, done);
    onChange();
  };
  const name = topic?.title ?? 'All topics';
  let body: ReactNode = null;
  if (task.kind === 'guide') {
    body = m.guideFileId ? <Link to={`/files/${m.guideFileId}`} className="text-accent underline underline-offset-2">Read the study guide</Link> : making;
  } else if (task.kind === 'cards' || task.kind === 'review') {
    if (m.tray?.length && task.topicId) body = <Tray courseId={courseId} topicId={task.topicId} m={m} onDone={onChange} />;
    else if (m.cardIds?.length) body = <Link to={`/review?course=${encodeURIComponent(courseId)}`} className="text-accent underline underline-offset-2">Review your cards ({m.cardIds.length} for this topic)</Link>;
    else if (m.tray || m.cardIds) body = <span className="text-sm text-text-3">No cards for this topic yet. Make some from the Create tab, or add a file about it.</span>;
    else body = making;
  } else if (task.kind === 'quiz') {
    const q = m.quizIds?.[0];
    body = q ? <Link to={`/quizzes/${q}`} className="text-accent underline underline-offset-2">Take the re-check quiz</Link> : m.quizIds ? <span className="text-sm text-text-3">No quiz could be made for this topic.</span> : making;
  } else if (task.kind === 'test') {
    body = plan.test && !plan.test.takenAt ? <Link to={`/quizzes/${plan.test.quizId}`} className="text-accent underline underline-offset-2">Take the practice test</Link> : making;
  }
  const label = { guide: 'Learn', cards: 'Make your cards', review: 'Quick review', quiz: 'Re-check', test: 'Full practice test' }[task.kind];
  return (
    <li className={`flex flex-col gap-2 rounded-md border p-3 ${task.done ? 'border-border bg-sunken' : 'border-border-strong bg-surface'}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-text">
          <span className="font-semibold">{label}:</span> {name}
          {task.done ? <span className="ml-2 text-sm text-text-2">✓ done</span> : null}
        </span>
        {day <= today && task.kind !== 'quiz' && task.kind !== 'test' ? (
          <Button size="sm" variant="ghost" onClick={() => void mark(!task.done)}>{task.done ? 'Not done' : 'Mark done'}</Button>
        ) : null}
      </div>
      {!task.done && day <= today ? body : null}
    </li>
  );
}

export function PlanPanel({ courseId, courseName }: { courseId: string; courseName: string }) {
  const toast = useToast();
  const job = usePlanJob();
  const version = usePlanVersion();
  const [lp, setLp] = useState<LoadedPlan | null | undefined>(undefined);
  const [refresh, setRefresh] = useState(0);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchPlan(courseId).then((p) => !cancelled && setLp(p), () => !cancelled && setLp(null));
    return () => {
      cancelled = true;
    };
  }, [courseId, version, refresh]);

  const start = async () => {
    try {
      await startPlan(courseId, courseName);
      kickPlansSoon();
      setRefresh((n) => n + 1);
    } catch (e) {
      toast.show({ message: e instanceof Error ? e.message : 'Couldn’t start the plan.', tone: 'error' });
    }
  };
  const reset = async () => {
    setConfirmReset(false);
    await deletePlan(courseId);
    await start();
  };

  if (lp === undefined) return <p className="text-text-2">Loading the study plan…</p>;
  const live = job?.courseId === courseId ? job.progress : null;

  if (lp === null) {
    return (
      <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
        <h2 className="text-lg font-semibold">Study plan</h2>
        <p className="text-text-2">Studyflare can make a 20-question practice test for this course (from your processed files, or from trusted websites if there aren’t enough yet), then build a day-by-day plan around the topics you miss: study guides, cards and short re-check quizzes, with a fresh check-in test every week.</p>
        <div><Button variant="primary" onClick={() => void start()}>Make my practice test</Button></div>
      </section>
    );
  }

  const { plan, stage } = lp;
  const today = dayKey(Date.now());

  const resetDialog = (
    <ConfirmDialog
      open={confirmReset}
      title="Start this plan over?"
      message="The topic scores and the schedule are cleared and a new practice test is made. Cards, study guides and quizzes already made stay in the course."
      confirmLabel="Start over"
      destructive
      onConfirm={() => void reset()}
      onCancel={() => setConfirmReset(false)}
    />
  );

  if (stage === 'building' || stage === 'failed') {
    const b = live ?? plan.build;
    return (
      <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5" aria-live="polite">
        <h2 className="text-lg font-semibold">{stage === 'failed' ? 'The practice test couldn’t be made' : 'Making your practice test'}</h2>
        {stage === 'failed' ? (
          <>
            <p className="text-danger">{plan.build?.error ?? 'Something went wrong.'}</p>
            <div><Button variant="primary" onClick={() => void reset()}>Try again</Button></div>
          </>
        ) : (
          <>
            <p className="text-text">{b ? `${b.step}${b.total > 1 ? ` (${b.done} of ${b.total} topics)` : '…'}` : 'Waiting to start…'}</p>
            {plan.topics.length ? <p className="text-sm text-text-2">Topics: {plan.topics.map((t) => t.title).join(' · ')}</p> : null}
            <p className="text-sm text-text-3">This takes a few minutes and runs in the background while Studyflare is open (any page). If the page reloads, it carries on where it stopped.</p>
          </>
        )}
      </section>
    );
  }

  if (stage === 'test_ready' && plan.test) {
    return (
      <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
        <h2 className="text-lg font-semibold">Your practice test is ready</h2>
        <p className="text-text">About 25 minutes, across {plan.topics.length} topics: {plan.topics.map((t) => t.title).join(' · ')}.</p>
        <p className="text-sm text-text-2">{plan.basis === 'web' ? 'Written from trusted websites about this course' : 'Written from your own files'}; every question was checked against its source. Your score per topic decides what goes in your plan.</p>
        <div className="flex flex-wrap gap-2">
          <Link to={`/quizzes/${plan.test.quizId}`} className="inline-flex min-h-10 items-center rounded-md bg-accent px-4 font-semibold text-on-accent hover:opacity-90">Take the practice test</Link>
          <Button variant="ghost" onClick={() => setConfirmReset(true)}>Make a different test</Button>
        </div>
        {resetDialog}
      </section>
    );
  }

  const upcoming: PlanDay[] = plan.days.filter((d) => d.day >= today);
  const todayDay = upcoming[0]?.day === today ? upcoming[0] : null;
  const later = upcoming.filter((d) => d.day !== today && d.tasks.length > 0).slice(0, 7);
  const end = plan.days[plan.days.length - 1]?.day;
  const pending = plan.test && !plan.test.takenAt ? plan.test : null;
  const lastTaken = [plan.test, ...plan.pastTests].filter((t) => t?.takenAt).sort((a, b) => (b?.takenAt ?? 0) - (a?.takenAt ?? 0))[0];
  const nextCheck = lastTaken?.takenAt ? dayKey(lastTaken.takenAt + 7 * 86_400_000) : null;

  return (
    <div className="flex flex-col gap-6">
      {pending ? (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent bg-accent-bg p-4">
          <p className="text-text"><strong>{pending.kind === 'weekly' ? 'Your weekly check-in test is ready.' : 'Your practice test is ready.'}</strong> It updates your topic scores and re-plans the days ahead.</p>
          <Link to={`/quizzes/${pending.quizId}`} className="inline-flex min-h-10 items-center rounded-md bg-accent px-4 font-semibold text-on-accent hover:opacity-90">Take it</Link>
        </section>
      ) : null}

      <section aria-labelledby="today-plan" className="flex flex-col gap-3">
        <h2 id="today-plan" className="text-lg font-semibold">Today</h2>
        {todayDay && todayDay.tasks.length ? (
          <ul className="flex flex-col gap-2">
            {todayDay.tasks.map((t, i) => <TaskRow key={`${t.kind}-${t.topicId}-${i}`} task={t} plan={plan} courseId={courseId} day={today} today={today} onChange={() => setRefresh((n) => n + 1)} />)}
          </ul>
        ) : (
          <p className="text-text-2">Nothing planned for today. Keep up with your card reviews.</p>
        )}
      </section>

      <section aria-labelledby="scores" className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
        <h2 id="scores" className="text-lg font-semibold">Your topics</h2>
        <p className="text-sm text-text-2">
          From your {lastTaken?.kind === 'weekly' ? 'latest check-in test' : 'practice test'}{lastTaken?.score != null ? ` (${pct(lastTaken.score)})` : ''}, then your quizzes and card reviews. Topics under {Math.round(WEAK * 100)}% get study time in the plan.
        </p>
        <ul className="flex flex-col gap-3">
          {[...plan.topics].sort((a, b) => (a.score ?? -1) - (b.score ?? -1)).map((t) => <ScoreBar key={t.id} t={t} />)}
        </ul>
        <p className="text-sm text-text-3">
          {end ? `The plan runs to ${fmtDay(end, today)}. ` : ''}
          {nextCheck && !pending ? `Next check-in test: ${fmtDay(nextCheck, today)}.` : ''} Set an exam date on the Overview tab and the plan ends there.
        </p>
      </section>

      {later.length ? (
        <section aria-labelledby="coming-up" className="flex flex-col gap-2">
          <h2 id="coming-up" className="text-lg font-semibold">Coming up</h2>
          <ol className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
            {later.map((d) => (
              <li key={d.day} className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-2 text-sm">
                <span className="w-28 font-medium text-text">{fmtDay(d.day, today)}</span>
                <span className="text-text-2">
                  {d.tasks.map((t) => `${{ guide: 'Learn', cards: 'Cards', review: 'Review', quiz: 'Re-check', test: 'Practice test' }[t.kind]}${t.topicId ? `: ${plan.topics.find((x) => x.id === t.topicId)?.title ?? ''}` : ''}`).filter((s, i, a) => a.indexOf(s) === i).join(' · ')}
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <div>
        <Button variant="ghost" size="sm" onClick={() => setConfirmReset(true)}>Start the plan over</Button>
      </div>
      {resetDialog}
    </div>
  );
}
