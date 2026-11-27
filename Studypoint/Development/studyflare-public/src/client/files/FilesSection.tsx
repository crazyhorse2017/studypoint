// Library → Files (LIB-02): upload PDFs, Word, PowerPoint, Markdown and photos into a course. Each file
// is type-checked and encrypted in this browser before it's uploaded (AUTH-08). Click one to open it.

import { useCallback, useEffect, useState } from 'react';
import { Button, FileDrop, Select, useToast } from '../ds/index.ts';
import { formatBytes } from '../ds/fileRules.ts';
import { Link } from '../Link.tsx';
import { useStudy } from '../studyStore.ts';
import { ImportLink } from './ImportLink.tsx';
import { DuplicateFile, KIND_LABEL, deleteFile, fetchFiles, restoreFile, uploadFile, type FileItem } from './filesApi.ts';

type Job = { name: string; done: number; total: number; error: string | null };

/** With `course`, the section belongs to that course page: no course picker, only its files. */
export function FilesSection({ course }: { course?: string }) {
  const toast = useToast();
  const { courses } = useStudy();
  const active = courses.filter((c) => !c.archived);
  const options = active.map((c) => ({ value: c.id, label: c.code ? `${c.code} · ${c.name}` : c.name }));
  const [courseId, setCourseId] = useState<string | null>(course ?? null);
  const [files, setFiles] = useState<FileItem[] | null>(null);
  const [storage, setStorage] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);

  const refresh = useCallback(() => {
    fetchFiles(course ?? null).then(
      (r) => {
        setFiles(r.files);
        setStorage(r.storage);
      },
      (e) => setError(e instanceof Error ? e.message : 'Your files couldn’t be loaded.'),
    );
  }, [course]);
  useEffect(refresh, [refresh]);

  const target = course ?? courseId ?? (active.length === 1 ? (active[0]?.id ?? null) : null);

  const upload = async (picked: File[]) => {
    if (!target) return;
    const start = jobs.length;
    setJobs((j) => [...j, ...picked.map((f) => ({ name: f.name, done: 0, total: 1, error: null }))]);
    // One at a time keeps memory low (each file is held decrypted while it's encrypted and sent).
    for (let i = 0; i < picked.length; i += 1) {
      const f = picked[i] as File;
      const update = (patch: Partial<Job>) => setJobs((j) => j.map((x, idx) => (idx === start + i ? { ...x, ...patch } : x)));
      try {
        await uploadFile(f, target, (done, total) => update({ done, total }));
        update({ done: 1, total: 1 });
      } catch (e) {
        update({ error: e instanceof DuplicateFile ? e.message : e instanceof Error ? e.message : 'Upload failed.' });
      }
    }
    refresh();
    setTimeout(() => setJobs((j) => j.filter((x) => x.error !== null)), 2500);
  };

  const remove = async (f: FileItem) => {
    try {
      await deleteFile(f.id);
      refresh();
      toast.show({ message: `${f.title} moved to the trash`, action: { label: 'Undo', onAction: () => void restoreFile(f.id).then(refresh) } });
    } catch (e) {
      toast.show({ message: e instanceof Error ? e.message : 'Couldn’t delete the file.', tone: 'error' });
    }
  };

  const courseName = (id: string | null) => {
    const c = courses.find((x) => x.id === id);
    return c ? (c.code ?? c.name) : null;
  };

  return (
    <section aria-labelledby="files-heading" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="files-heading" className="text-xl font-semibold">
          Files
        </h2>
        <p className="text-sm text-text-2">PDFs, Word, PowerPoint, Markdown and photos, up to 100 MB each. Encrypted on this device before they’re uploaded.</p>
      </div>

      {!storage ? (
        <p className="rounded-lg border border-border-strong bg-sunken p-3 text-sm text-text">File storage isn’t turned on for this Studyflare yet.</p>
      ) : active.length === 0 ? (
        <p className="text-sm text-text-2">Add a course or subject first. Every file belongs to one.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {!course && active.length > 1 ? (
            <div className="max-w-md">
              <Select label="Upload into" value={courseId} placeholder="Choose a course" options={options} onChange={setCourseId} />
            </div>
          ) : null}
          <FileDrop
            label={target ? `Drop files here, or choose files to upload into ${courseName(target) ?? 'this course'}` : 'Choose a course above first'}
            disabled={!target}
            onFiles={(f) => void upload(f)}
            onRejected={(reasons) => toast.show({ message: reasons.join(' '), tone: 'error' })}
          />
          {target ? <ImportLink courseId={target} onImported={refresh} /> : null}
        </div>
      )}

      {jobs.length > 0 ? (
        <ul aria-label="Uploads" className="flex flex-col gap-2">
          {jobs.map((j, i) => (
            <li key={`${j.name}-${i}`} className="flex flex-col gap-1 rounded-md border border-border bg-surface p-3 text-sm">
              <span className="flex justify-between gap-3">
                <span className="truncate text-text">{j.name}</span>
                <span className={j.error ? 'text-danger' : 'text-text-2'}>
                  {j.error ? 'Not uploaded' : j.done >= j.total ? 'Uploaded' : `Encrypting and uploading… ${Math.round((j.done / j.total) * 100)}%`}
                </span>
              </span>
              {j.error ? <span className="text-danger">{j.error}</span> : (
                <span
                  role="progressbar"
                  aria-label={`Upload progress for ${j.name}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round((j.done / j.total) * 100)}
                  className="block h-1.5 overflow-hidden rounded-full bg-sunken"
                >
                  <span className="block h-full bg-accent transition-[width]" style={{ width: `${(j.done / j.total) * 100}%` }} />
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {files === null && !error ? <p className="text-text-2">Decrypting your file list…</p> : null}
      {files !== null && files.length === 0 ? <p className="rounded-lg border border-dashed border-border-strong p-5 text-text-2">No files yet.</p> : null}
      {files !== null && files.length > 0 ? (
        <ul className="rounded-lg border border-border bg-surface px-5">
          {files.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-3 last:border-0">
              {f.status === 'ready' ? (
                <Link to={`/files/${f.id}`} className={f.unreadable ? 'text-danger' : 'text-text hover:text-accent'}>
                  {f.title}
                </Link>
              ) : (
                <span className="text-text-2">{f.title} · upload didn’t finish</span>
              )}
              <span className="flex items-center gap-3 text-sm text-text-3">
                <span>{f.origin === 'link' && f.kind === 'md' ? 'Web page' : KIND_LABEL[f.kind]}{f.origin === 'link' ? ' · from a link' : ''}</span>
                <span>{formatBytes(f.bytes)}</span>
                {!course && courseName(f.courseId) ? <span className="font-mono">{courseName(f.courseId)}</span> : null}
                <Button size="sm" variant="ghost" aria-label={`Delete ${f.title}`} onClick={() => void remove(f)}>
                  Delete
                </Button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
