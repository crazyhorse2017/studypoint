// "Processed for AI" status for a course (step 5): how many files and notes are read and searchable, and a
// button to process the rest. Processing runs in this browser (decrypt → read → OCR where needed →
// passages → search vectors → encrypt → save), one source at a time.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../ds/index.ts';
import { processSource, staleSources, type SourceRef } from './indexer.ts';

export type ProcessState = { total: number; stale: number; ready: boolean };

/** `onChecked` runs after each status check (initially and after processing), e.g. to reload the search index. */
export function ProcessPanel({ courseId, onChecked }: { courseId: string; onChecked?: (s: ProcessState) => void }) {
  const [state, setState] = useState<{ all: SourceRef[]; stale: SourceRef[] } | null>(null);
  const [running, setRunning] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  // Held in a ref so a new callback each render doesn't re-run the check (and loop).
  const cb = useRef(onChecked);
  cb.current = onChecked;

  const check = useCallback(async () => {
    try {
      const s = await staleSources(courseId);
      setState(s);
      cb.current?.({ total: s.all.length, stale: s.stale.length, ready: s.all.length > 0 && s.stale.length < s.all.length });
    } catch (e) {
      setErrors([e instanceof Error ? e.message : 'Couldn’t check this course.']);
    }
  }, [courseId]);
  useEffect(() => {
    void check();
  }, [check]);

  const run = async () => {
    if (!state) return;
    setRunning(true);
    setErrors([]);
    const errs: string[] = [];
    for (const [i, s] of state.stale.entries()) {
      try {
        await processSource(s, (msg) => setLine(`${i + 1} of ${state.stale.length}: ${msg}`));
      } catch (e) {
        errs.push(`${s.title}: ${e instanceof Error ? e.message : 'failed'}`);
        if (e instanceof Error && /allowance/.test(e.message)) break; // no point continuing today
      }
    }
    setErrors(errs);
    setLine(null);
    setRunning(false);
    await check();
  };

  if (!state) return <p className="text-sm text-text-2">Checking which materials are ready for AI…</p>;
  const done = state.all.length - state.stale.length;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text">
          {state.all.length === 0 ? (
            'Add files, links or notes to this course first. The AI works only from your own material.'
          ) : (
            <>
              <strong>{done}</strong> of {state.all.length} item{state.all.length === 1 ? '' : 's'} ready for AI
              {state.stale.length > 0 ? ` · ${state.stale.length} new or changed` : ' · all up to date'}
            </>
          )}
        </p>
        {state.stale.length > 0 ? (
          <Button size="sm" variant="primary" loading={running} onClick={() => void run()}>
            {running ? 'Processing…' : `Process ${state.stale.length}`}
          </Button>
        ) : null}
      </div>
      {line ? (
        <p className="text-sm text-text-2" aria-live="polite">
          {line}. <strong className="text-text">Keep this tab open</strong> (other pages of Studyflare are fine). If it reloads, press Process again: pages already read are remembered.
        </p>
      ) : null}
      {errors.length ? (
        <ul className="text-sm text-danger">
          {errors.map((e) => <li key={e}>{e}</li>)}
        </ul>
      ) : null}
      <p className="text-xs text-text-3">Processing reads each item on this device, uses Cloudflare’s AI to read photos and scanned pages and to make them searchable, and saves the result encrypted.</p>
    </div>
  );
}
