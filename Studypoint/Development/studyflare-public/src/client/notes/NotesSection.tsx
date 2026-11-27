// Library → Notes (LIB-08): your typed notes, newest first, filterable by course. Titles are decrypted
// in the browser; the server only has ciphertext.

import { useEffect, useState } from 'react';
import { Button, Dialog, Select, useToast } from '../ds/index.ts';
import { Link } from '../Link.tsx';
import { navigate } from '../router.ts';
import { useStudy } from '../studyStore.ts';
import { UNTITLED, createNote, fetchNotes, type NoteItem } from './notesApi.ts';

const when = (ms: number) => new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** With `course`, the section belongs to that course page: only its notes, and New note goes straight in. */
export function NotesSection({ course }: { course?: string }) {
  const toast = useToast();
  const { courses } = useStudy();
  const [filter, setFilter] = useState<string>(course ?? 'all');
  const [notes, setNotes] = useState<NoteItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [picking, setPicking] = useState(false);
  const [pickCourse, setPickCourse] = useState<string | null>(null);

  useEffect(() => {
    fetchNotes(course ?? null).then(setNotes, (e) => setError(e instanceof Error ? e.message : 'Your notes couldn’t be loaded.'));
  }, [course]);

  const courseLabel = (id: string | null) => {
    const c = courses.find((x) => x.id === id);
    return c ? c.code ?? c.name : null;
  };

  const shown = (notes ?? []).filter((n) => filter === 'all' || (filter === 'none' ? n.courseId === null : n.courseId === filter));

  const activeCourses = courses.filter((c) => !c.archived).map((c) => ({ value: c.id, label: c.code ? `${c.code} · ${c.name}` : c.name }));
  const filteredCourse = course ?? (activeCourses.some((c) => c.value === filter) ? filter : null);

  /** Every note belongs to a course: use the one being shown, or ask. */
  const newNote = async (courseId: string) => {
    setPicking(false);
    setCreating(true);
    try {
      navigate(`/notes/${await createNote(courseId)}`);
    } catch (e) {
      toast.show({ message: e instanceof Error ? e.message : 'Couldn’t create a note.', tone: 'error' });
      setCreating(false);
    }
  };

  const hasLooseNotes = (notes ?? []).some((n) => n.courseId === null);
  const options = [
    { value: 'all', label: 'All notes' },
    ...(hasLooseNotes ? [{ value: 'none', label: 'Needs a course' }] : []),
    ...activeCourses,
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
          {!course && (activeCourses.length > 0 || hasLooseNotes) ? (
            <div className="min-w-56">
              <Select label="Show" value={filter} options={options} onChange={setFilter} />
            </div>
          ) : null}
          <Button
            variant="primary"
            loading={creating}
            disabled={activeCourses.length === 0}
            onClick={() => (filteredCourse ? void newNote(filteredCourse) : setPicking(true))}
          >
            New note
          </Button>
        </div>
      </div>
      {activeCourses.length === 0 ? <p className="text-sm text-text-2">Add a course first. Every note belongs to one.</p> : null}
      <Dialog
        open={picking}
        onClose={() => setPicking(false)}
        title="Which course is this note for?"
        actions={
          <>
            <Button variant="ghost" onClick={() => setPicking(false)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!pickCourse} onClick={() => pickCourse && void newNote(pickCourse)}>
              Create note
            </Button>
          </>
        }
      >
        <Select label="Course" value={pickCourse} placeholder="Choose a course" options={activeCourses} onChange={setPickCourse} />
      </Dialog>
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
                  {!course && courseLabel(n.courseId) ? <span className="font-mono">{courseLabel(n.courseId)}</span> : null}
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
