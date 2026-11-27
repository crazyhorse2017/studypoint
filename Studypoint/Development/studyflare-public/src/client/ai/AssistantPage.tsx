// The "Ask" page in the main navigation (step 6a): pick a course and ask within it, or reopen any saved
// conversation from every course. `?chat=<id>` opens one (the id is random, never the content).

import { useEffect, useState } from 'react';
import { Select } from '../ds/index.ts';
import { Link } from '../Link.tsx';
import { useLocation } from '../router.ts';
import { useStudy } from '../studyStore.ts';
import { AskPanel } from './AskPanel.tsx';
import { fetchChats, type ChatSummary } from '../chats/chatApi.ts';

const when = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: new Date(ms).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });

export default function AssistantPage() {
  const { courses, loaded } = useStudy();
  const { search } = useLocation();
  const active = courses.filter((c) => !c.archived);
  const [courseId, setCourseId] = useState<string | null>(null);
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(search.get('chat'));

  useEffect(() => {
    fetchChats().then(setChats, () => setChats([]));
  }, []);

  // A conversation link picks its course.
  const wanted = openId ? chats?.find((c) => c.id === openId) : undefined;
  const chosen = wanted?.courseId ?? courseId ?? (active.length === 1 ? (active[0]?.id ?? null) : null);
  const courseLabel = (id: string | null) => {
    const c = courses.find((x) => x.id === id);
    return c ? (c.code ?? c.name) : 'No course';
  };

  const pick = (id: string | null) => {
    setOpenId(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('chat', id);
    else url.searchParams.delete('chat');
    window.history.replaceState(null, '', url.pathname + url.search);
    // A conversation that was just started: refresh the list so it shows up.
    if (id && !chats?.some((c) => c.id === id)) fetchChats().then(setChats, () => undefined);
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-[2.125rem] leading-tight font-semibold">Ask</h1>
        <p className="text-text-2">Answers come from your own material, with every citation checked word for word. If your material doesn’t cover it, look it up on trusted websites.</p>
      </div>
      {loaded && active.length === 0 ? <p className="text-text-2"><Link to="/setup" className="text-accent underline underline-offset-2">Add a course</Link> first.</p> : null}
      {active.length > 1 ? (
        <div className="max-w-md">
          <Select
            label="Course"
            value={chosen}
            placeholder="Choose a course"
            options={active.map((c) => ({ value: c.id, label: c.code ? `${c.code} · ${c.name}` : c.name }))}
            onChange={(v) => {
              setCourseId(v);
              pick(null);
            }}
          />
        </div>
      ) : null}
      {chosen ? <AskPanel key={chosen} courseId={chosen} chatId={wanted ? openId : null} onChatChange={pick} /> : null}

      {chats && chats.length > 0 ? (
        <section aria-labelledby="all-chats" className="flex flex-col gap-2 border-t border-border pt-6">
          <h2 id="all-chats" className="text-lg font-semibold">All conversations</h2>
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
            {chats.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className="flex w-full flex-wrap items-baseline justify-between gap-2 px-4 py-3 text-left hover:bg-sunken"
                  aria-current={c.id === openId ? 'true' : undefined}
                  onClick={() => {
                    setCourseId(c.courseId);
                    pick(c.id);
                    window.scrollTo({ top: 0 });
                  }}
                >
                  <span className="font-medium text-text">{c.title}</span>
                  <span className="text-sm text-text-3">{courseLabel(c.courseId)} · {Math.floor(c.messages / 2)} question{Math.floor(c.messages / 2) === 1 ? '' : 's'} · {when(c.updatedAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
