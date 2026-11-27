// The "Ask" page in the main navigation: pick a course, then ask or search within it.

import { useState } from 'react';
import { Select } from '../ds/index.ts';
import { Link } from '../Link.tsx';
import { useStudy } from '../studyStore.ts';
import { AskPanel } from './AskPanel.tsx';

export default function AssistantPage() {
  const { courses, loaded } = useStudy();
  const active = courses.filter((c) => !c.archived);
  const [courseId, setCourseId] = useState<string | null>(null);
  const chosen = courseId ?? (active.length === 1 ? (active[0]?.id ?? null) : null);
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-[2.125rem] leading-tight font-semibold">Ask</h1>
        <p className="text-text-2">Answers come from your own material, with every citation checked word for word. If your material doesn’t cover it, look it up on trusted websites.</p>
      </div>
      {loaded && active.length === 0 ? <p className="text-text-2"><Link to="/setup" className="text-accent underline underline-offset-2">Add a course</Link> first.</p> : null}
      {active.length > 1 ? (
        <div className="max-w-md">
          <Select label="Course" value={chosen} placeholder="Choose a course" options={active.map((c) => ({ value: c.id, label: c.code ? `${c.code} · ${c.name}` : c.name }))} onChange={setCourseId} />
        </div>
      ) : null}
      {chosen ? <AskPanel key={chosen} courseId={chosen} /> : null}
    </div>
  );
}
