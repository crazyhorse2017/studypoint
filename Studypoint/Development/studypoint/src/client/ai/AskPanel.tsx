// Ask and Search (AST-01..07, LIB-07, LKP-01). Search shows matching passages; Ask answers from the best
// passages with every citation checked word-for-word against your material (anything that can't be
// checked is shown as unverified). If your material doesn't cover it, look it up on trusted websites.

import { useEffect, useState } from 'react';
import { Button, SegmentedControl, Switch, TextArea, useToast } from '../ds/index.ts';
import { Link } from '../Link.tsx';
import { verifyAnswer, type Segment, type VerifiedAnswer } from '../../shared/answer.ts';
import type { Hit } from '../../shared/searchIndex.ts';
import { MathText } from '../cards/MathText.tsx';
import { uploadFile } from '../files/filesApi.ts';
import { askModel, webLookup, type SentPassage, type WebResult } from './aiApi.ts';
import { loadCourseIndex, passageLink, searchCourse, type CourseIndex } from './indexer.ts';
import { ProcessPanel } from './ProcessPanel.tsx';

type Source = { ref: string; title: string; loc: string; href: string; external: boolean; text: string; ocr: boolean };
type Turn = { question: string; answer: VerifiedAnswer; sources: Source[]; web: boolean };

function SegmentView({ s, sources }: { s: Segment; sources: readonly Source[] }) {
  const chip = (ref: string) => {
    const src = sources.find((x) => x.ref === ref);
    if (!src) return null;
    const label = `${src.title}${src.loc ? `, ${src.loc}` : ''}`;
    return src.external ? (
      <a key={ref} href={src.href} target="_blank" rel="noopener noreferrer" className="ml-1 rounded-sm bg-sunken px-1 text-xs text-accent no-underline hover:underline" title={label}>{ref}</a>
    ) : (
      <Link key={ref} to={src.href} className="ml-1 rounded-sm bg-sunken px-1 text-xs text-accent no-underline hover:underline" title={label}>{ref}</Link>
    );
  };
  if (s.kind === 'general') {
    return <p className="border-l-2 border-border-strong pl-3 text-text-2"><span className="mr-2 text-xs font-semibold uppercase tracking-wide text-text-3">General knowledge</span><MathText text={s.text} /></p>;
  }
  if (s.kind === 'unverified') {
    return (
      <details className="rounded-md border border-dashed border-danger px-3 py-1 text-text-2">
        <summary className="cursor-pointer text-sm text-danger">Couldn’t verify this against your sources</summary>
        <MathText text={s.text} />
      </details>
    );
  }
  return (
    <p className="text-text">
      <MathText text={s.text} />
      {s.citations.filter((c) => c.verified).map((c) => chip(c.ref))}
      {s.conflict ? <span className="ml-2 text-xs text-danger">sources disagree</span> : null}
      {s.uncertain ? <span className="ml-2 text-xs text-text-3">from OCR, check the page</span> : null}
    </p>
  );
}

export function AskPanel({ courseId }: { courseId: string }) {
  const toast = useToast();
  const [mode, setMode] = useState<'ask' | 'search'>('ask');
  const [q, setQ] = useState('');
  const [tutor, setTutor] = useState(false);
  const [index, setIndex] = useState<CourseIndex | null>(null);
  const [busy, setBusy] = useState(false);
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [processed, setProcessed] = useState(0);

  useEffect(() => {
    setIndex(null);
    loadCourseIndex(courseId).then(setIndex, () => setIndex(null));
  }, [courseId, processed]);

  const isNote = (id: string) => Boolean(index?.noteIds.has(id));

  const toSources = (hs: readonly Hit[]): Source[] =>
    hs.map((h, i) => ({ ref: `P${i + 1}`, title: index?.titles.get(h.passage.sourceId) ?? 'Source', loc: h.passage.loc, href: passageLink(h.passage, isNote(h.passage.sourceId)), external: false, text: h.passage.text, ocr: h.passage.ocr }));

  const ask = async (question: string, general: boolean, sourcesOverride?: Source[]) => {
    setError(null);
    setBusy(true);
    try {
      let sources = sourcesOverride;
      if (!sources) {
        if (!index || index.passages.length === 0) throw new Error('Process this course’s material first (above).');
        sources = toSources(await searchCourse(index, question, 8));
        if (sources.length === 0) throw new Error('Nothing in your material matches that. Try other words, or look it up on the web.');
      }
      const sent: SentPassage[] = sources.map((s) => ({ ref: s.ref, label: `${s.title}${s.loc ? `, ${s.loc}` : ''}`, text: s.text, ocr: s.ocr, url: s.external ? s.href : undefined }));
      const raw = await askModel(question, sent, tutor ? 'tutor' : 'direct', general);
      const answer = verifyAnswer(raw, sources.map((s) => ({ ref: s.ref, text: s.text, ocr: s.ocr })));
      setTurns((t) => [...t, { question, answer, sources, web: Boolean(sourcesOverride?.some((s) => s.external)) }]);
      setQ('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const lookUp = async (question: string) => {
    setError(null);
    setBusy(true);
    try {
      const { results } = await webLookup(question);
      if (results.length === 0) throw new Error('No trusted websites matched. Try different words.');
      const sources: Source[] = results.slice(0, 6).map((r: WebResult, i) => ({ ref: `P${i + 1}`, title: r.title, loc: new URL(r.url).hostname, href: r.url, external: true, text: r.content, ocr: false }));
      setBusy(false);
      await ask(question, false, sources);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The web lookup failed.');
      setBusy(false);
    }
  };

  const search = async () => {
    setError(null);
    if (!index || index.passages.length === 0) return setError('Process this course’s material first (above).');
    setBusy(true);
    try {
      setHits(await searchCourse(index, q, 12));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed.');
    } finally {
      setBusy(false);
    }
  };

  const saveWebSource = async (s: Source) => {
    try {
      const body = `# ${s.title}\n\n> From [${s.href}](${s.href}), found by Studyflare’s trusted web lookup on ${new Date().toLocaleDateString()}.\n\n${s.text}\n`;
      await uploadFile(new File([body], `${s.title.slice(0, 100)}.md`, { type: 'text/markdown' }), courseId, undefined, 'link');
      toast.show({ message: 'Saved to this course’s files' });
    } catch (e) {
      toast.show({ message: e instanceof Error ? e.message : 'Couldn’t save it.', tone: 'error' });
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <ProcessPanel courseId={courseId} onChecked={() => setProcessed((n) => n + 1)} />
      <SegmentedControl label="What do you want to do?" value={mode} options={[{ value: 'ask', label: 'Ask a question' }, { value: 'search', label: 'Search my material' }]} onChange={setMode} />
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!q.trim()) return;
          if (mode === 'ask') void ask(q.trim(), true);
          else void search();
        }}
      >
        <TextArea label={mode === 'ask' ? 'Your question' : 'Search for'} rows={2} value={q} onChange={(e) => setQ(e.target.value)} placeholder={mode === 'ask' ? 'e.g. Why does the heat flux point down the temperature gradient?' : 'e.g. Fourier’s law'} />
        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" variant="primary" loading={busy}>{mode === 'ask' ? 'Ask' : 'Search'}</Button>
          {mode === 'ask' ? <Switch checked={tutor} onChange={setTutor} label="Tutor mode" description="Hints and guiding questions instead of the answer." /> : null}
        </div>
      </form>
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}

      {mode === 'search' && hits ? (
        hits.length === 0 ? <p className="text-text-2">No matches.</p> : (
          <ol className="flex flex-col gap-2">
            {hits.map((h) => (
              <li key={h.passage.id} className="rounded-md border border-border bg-surface p-3">
                <Link to={passageLink(h.passage, isNote(h.passage.sourceId))} className="text-sm font-semibold text-accent hover:underline">
                  {index?.titles.get(h.passage.sourceId) ?? 'Source'} · {h.passage.loc}
                </Link>
                <p className="mt-1 line-clamp-4 text-sm text-text-2"><MathText text={h.passage.text} /></p>
              </li>
            ))}
          </ol>
        )
      ) : null}

      {mode === 'ask' ? (
        <div className="flex flex-col gap-6" aria-live="polite">
          {[...turns].reverse().map((t, i) => (
            <article key={turns.length - i} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
              <h3 className="font-semibold text-text">{t.question}</h3>
              {t.answer.coverage === 'not_found' ? <p className="text-text-2">{t.web ? 'The trusted websites found don’t answer this either.' : 'Not found in your materials.'}</p> : null}
              {t.answer.segments.map((s, j) => <SegmentView key={j} s={s} sources={t.sources} />)}
              {t.answer.failedCount > 0 ? <p className="text-xs text-text-3">{t.answer.failedCount} citation{t.answer.failedCount === 1 ? '' : 's'} couldn’t be verified and {t.answer.failedCount === 1 ? 'was' : 'were'} left out.</p> : null}
              {t.answer.coverage !== 'covered' && !t.web ? (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => void lookUp(t.question)} disabled={busy}>Look it up on trusted websites</Button>
                </div>
              ) : null}
              <details className="text-sm">
                <summary className="cursor-pointer text-text-2">Sources ({t.sources.length})</summary>
                <ol className="mt-2 flex flex-col gap-1">
                  {t.sources.map((s) => (
                    <li key={s.ref} className="flex flex-wrap items-baseline gap-2">
                      <span className="font-mono text-xs text-text-3">{s.ref}</span>
                      {s.external ? <a href={s.href} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">{s.title}</a> : <Link to={s.href} className="text-accent hover:underline">{s.title}</Link>}
                      <span className="text-text-3">{s.loc}</span>
                      {s.external ? <Button size="sm" variant="ghost" onClick={() => void saveWebSource(s)}>Save to course</Button> : null}
                    </li>
                  ))}
                </ol>
              </details>
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
}
