// Library → Notes (LIB-08): your typed notes, newest first, filterable by course. Titles are decrypted
// in the browser; the server only has ciphertext.

import { useEffect, useState } from 'react';
import { Button, Select, useToast } from '../ds/index.ts';
import { Link } from '../Link.tsx';
import { navigate } from '../router.ts';
import { useStudy } from '../studyStore.ts';
import { UNTITLED, createNote, fetchNotes, type NoteItem } from './notesApi.ts';

const when = (ms: number) => new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function NotesSection() {
  const toast = useToast();
  const { courses } = useStudy();
  const [filter, setFilter] = useState<string>('all');
  const [notes, setNotes] = useState<NoteItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetchNotes().then(setNotes, (e) => setError(e instanceof Error ? e.message : 'Your notes couldn’t be loaded.'));
  }, []);

  const courseLabel = (id: string | null) => {
    const c = courses.find((x) => x.id === id);
    return c ? c.code ?? c.name : null;
  };

  const shown = (notes ?? []).filter((n) => filter === 'all' || (filter === 'none' ? n.courseId === null : n.courseId === filter));

  const newNote = async () => {
    setCreating(true);
    try {
      const id = await createNote(filter === 'all' || filter === 'none' ? null : filter);
      navigate(`/notes/${id}`);
    } catch (e) {
      toast.show({ message: e instanceof Error ? e.message : 'Couldn’t create a note.', tone: 'error' });
      setCreating(false);
    }
  };

  const options = [
    { value: 'all', label: 'All notes' },
    { value: 'none', label: 'Not in a course' },
    ...courses.filter((c) => !c.archived).map((c) => ({ value: c.id, label: c.code ? `${c.code} · ${c.name}` : c.name })),
  ];

  return (
    <section aria-labelledby="notes-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="notes-heading" className="text-xl font-semibold">
            Notes
          </h2>
          <p className="text-sm text-text-2">Encrypted on this device before they’re saved.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {courses.length > 0 ? (
            <div className="min-w-56">
              <Select label="Show" value={filter} options={options} onChange={setFilter} />
            </div>
          ) : null}
          <Button variant="primary" loading={creating} onClick={() => void newNote()}>
            New note
          </Button>
        </div>
      </div>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {notes === null && !error ? <p className="text-text-2">Decrypting your notes…</p> : null}
      {notes !== null && shown.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border-strong p-5 text-text-2">
          {notes.length === 0 ? 'No notes yet. Start one with New note.' : 'No notes here yet.'}
        </p>
      ) : null}
      {shown.length > 0 ? (
        <ul className="rounded-lg border border-border bg-surface px-5">
          {shown.map((n) => (
            <li key={n.id} className="border-b border-border last:border-0">
              <Link to={`/notes/${n.id}`} className="flex flex-wrap items-baseline justify-between gap-3 py-3 hover:text-accent">
                <span className={n.unreadable ? 'text-danger' : n.title ? 'text-text' : 'text-text-3'}>{n.title || UNTITLED}</span>
                <span className="flex items-baseline gap-2 text-sm text-text-3">
                  {courseLabel(n.courseId) ? <span className="font-mono">{courseLabel(n.courseId)}</span> : null}
                  <span>{when(n.updatedAt)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
