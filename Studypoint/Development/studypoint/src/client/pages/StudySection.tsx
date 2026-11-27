// Settings → Study (CRD-05/06): new cards per day (default 20) and the recall target (default 90%).

import { useEffect, useState } from 'react';
import { Slider, useToast } from '../ds/index.ts';
import { fetchStudySettings, saveStudySettings, type StudySettings } from '../cards/cardsApi.ts';

export function StudySection() {
  const toast = useToast();
  const [s, setS] = useState<StudySettings | null>(null);
  useEffect(() => {
    fetchStudySettings().then((r) => setS(r.settings), () => setS(null));
  }, []);

  const save = (patch: Partial<StudySettings>) => {
    if (!s) return;
    const next = { ...s, ...patch };
    setS(next);
    saveStudySettings(patch).catch((e) => toast.show({ message: e instanceof Error ? e.message : 'Couldn’t save.', tone: 'error' }));
  };

  return (
    <section aria-labelledby="study-settings-heading" className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 id="study-settings-heading" className="text-xl font-semibold">
          Study
        </h2>
        <p className="text-sm text-text-2">
          The recall target is how much you aim to remember when a card comes back (90% means about 9 in 10). Higher means more reviews. Courses with an exam date add more new cards than the daily number when they need to, so every card is seen before the exam.
        </p>
      </div>
      {s ? (
        <>
          <Slider label="New cards per day" min={0} max={100} step={5} value={s.newPerDay} onChange={(v) => save({ newPerDay: v })} format={(v) => `${v} a day`} />
          <Slider
            label="Recall target"
            min={0.8}
            max={0.95}
            step={0.01}
            value={s.retention}
            onChange={(v) => save({ retention: Math.round(v * 100) / 100 })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </>
      ) : (
        <p className="text-text-2">Loading…</p>
      )}
    </section>
  );
}
