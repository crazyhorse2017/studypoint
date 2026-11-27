// The Reader (step 3, LIB-06): opens one uploaded file. It's downloaded as ciphertext, decrypted in this
// browser, then shown: PDF pages (pdf.js), images, Word documents and PowerPoint slides (read from their
// XML here, so no HTML from the file is ever injected), and Markdown as plain text.
// Loaded lazily: pdf.js and the unzipper only download when a file is opened.

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { unzipSync } from 'fflate';
import { Button, useToast } from '../ds/index.ts';
import { formatBytes } from '../ds/fileRules.ts';
import { navigate, useLocation } from '../router.ts';
import { useStudy } from '../studyStore.ts';
import { KIND_LABEL, deleteFile, fetchFile, openFile, restoreFile, type FileItem } from '../files/filesApi.ts';
import { imageMime, parseDocx, parsePptx, type Block, type Entries, type Run } from './ooxml.ts';
import { PdfView } from './PdfView.tsx';
import { MarkdownView } from './MarkdownView.tsx';

const EXT: Record<string, string> = {
  'application/pdf': '.pdf', 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'text/markdown': '.md',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
};

/** Object URLs for embedded images, revoked when the view goes away. */
function useImageUrls(entries: Entries | null, paths: readonly string[]): Map<string, string> {
  const urls = useMemo(() => {
    const m = new Map<string, string>();
    if (!entries) return m;
    for (const p of paths) {
      const bytes = entries[p];
      const mime = imageMime(p);
      if (bytes && mime) m.set(p, URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type: mime })));
    }
    return m;
  }, [entries, paths]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);
  return urls;
}

function Runs({ runs }: { runs: readonly Run[] }) {
  return (
    <>
      {runs.map((r, i) => {
        let node: ReactNode = r.text;
        if (r.sup) node = <sup>{node}</sup>;
        if (r.sub) node = <sub>{node}</sub>;
        if (r.underline) node = <u>{node}</u>;
        if (r.italic) node = <em>{node}</em>;
        if (r.bold) node = <strong>{node}</strong>;
        return <span key={i} className="whitespace-pre-wrap">{node}</span>;
      })}
    </>
  );
}

function DocxView({ entries }: { entries: Entries }) {
  const blocks = useMemo(() => parseDocx(entries), [entries]);
  const imagePaths = useMemo(() => blocks.flatMap((b) => (b.type === 'image' ? [b.path] : [])), [blocks]);
  const urls = useImageUrls(entries, imagePaths);
  // Consecutive list items become one list.
  const groups: Array<Block | Block[]> = [];
  for (const b of blocks) {
    const last = groups[groups.length - 1];
    if (b.type === 'item' && Array.isArray(last)) last.push(b);
    else groups.push(b.type === 'item' ? [b] : b);
  }
  if (blocks.length === 0) return <p className="text-text-2">This document has no text.</p>;
  return (
    <article className="reading doc-view mx-auto flex flex-col gap-3">
      {groups.map((g, i) => {
        if (Array.isArray(g)) {
          const ordered = g[0]?.type === 'item' && g[0].ordered;
          const items = g.map((it, j) => (it.type === 'item' ? <li key={j} style={{ marginLeft: `${it.level * 1.5}em` }}><Runs runs={it.runs} /></li> : null));
          return ordered ? <ol key={i}>{items}</ol> : <ul key={i}>{items}</ul>;
        }
        switch (g.type) {
          case 'heading':
            return g.level === 1 ? <h2 key={i}><Runs runs={g.runs} /></h2> : g.level === 2 ? <h3 key={i}><Runs runs={g.runs} /></h3> : <h4 key={i}><Runs runs={g.runs} /></h4>;
          case 'para':
            return <p key={i}><Runs runs={g.runs} /></p>;
          case 'table':
            return (
              <div key={i} className="overflow-x-auto">
                <table>
                  <tbody>
                    {g.rows.map((row, r) => (
                      <tr key={r}>{row.map((cell, c) => <td key={c}><Runs runs={cell} /></td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case 'image': {
            const url = urls.get(g.path);
            return url ? <img key={i} src={url} alt="Image from the document" className="max-w-full rounded-md" /> : <p key={i} className="text-sm text-text-3">[An image in a format browsers can’t show]</p>;
          }
          default:
            return null;
        }
      })}
    </article>
  );
}

function PptxView({ entries, initialSlide }: { entries: Entries; initialSlide: number }) {
  const slides = useMemo(() => parsePptx(entries), [entries]);
  const imagePaths = useMemo(() => slides.flatMap((s) => s.images), [slides]);
  const urls = useImageUrls(entries, imagePaths);
  useEffect(() => {
    if (initialSlide > 1) document.getElementById(`slide-${initialSlide}`)?.scrollIntoView({ block: 'start' });
  }, [initialSlide]);
  if (slides.length === 0) return <p className="text-text-2">This deck has no slides.</p>;
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <p className="text-sm text-text-2">Showing each slide’s text, pictures and speaker notes. Exact slide layouts aren’t reproduced; attach the PDF export of this deck to see slides as designed.</p>
      {slides.map((s) => (
        <section key={s.number} id={`slide-${s.number}`} aria-labelledby={`slide-${s.number}-title`} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5 shadow-pop">
          <h2 id={`slide-${s.number}-title`} className="flex items-baseline gap-3 text-lg font-semibold">
            <span className="font-mono text-sm text-text-3">Slide {s.number}</span>
            <span>{s.title || 'Untitled slide'}</span>
          </h2>
          {s.lines.length > 0 ? (
            <ul className="reading flex flex-col gap-1">
              {s.lines.map((l, i) => (
                <li key={i} style={{ marginLeft: `${l.level * 1.25}em` }} className="list-disc">
                  {l.text}
                </li>
              ))}
            </ul>
          ) : null}
          {s.images.map((p) => {
            const url = urls.get(p);
            return url ? <img key={p} src={url} alt={`Picture on slide ${s.number}`} className="max-h-96 max-w-full self-start rounded-md" /> : null;
          })}
          {s.notes.length > 0 ? (
            <div className="rounded-md bg-sunken p-3 text-sm text-text-2">
              <span className="font-semibold text-text">Speaker notes</span>
              {s.notes.map((n, i) => <p key={i}>{n}</p>)}
            </div>
          ) : null}
        </section>
      ))}
    </div>
  );
}

function ImageView({ bytes, mime, title }: { bytes: Uint8Array; mime: string; title: string }) {
  const url = useMemo(() => URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type: mime })), [bytes, mime]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const [zoomed, setZoomed] = useState(false);
  return (
    <div className="flex flex-col items-center gap-3">
      <Button size="sm" variant="ghost" aria-pressed={zoomed} onClick={() => setZoomed((z) => !z)}>
        {zoomed ? 'Fit to screen' : 'Actual size'}
      </Button>
      <div className="max-w-full overflow-auto">
        <img src={url} alt={title} className={zoomed ? 'max-w-none' : 'max-h-[80vh] max-w-full'} />
      </div>
    </div>
  );
}

export default function ReaderPage({ id }: { id: string }) {
  const toast = useToast();
  const { search } = useLocation();
  const { courses } = useStudy();
  const [file, setFile] = useState<FileItem | null>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [progress, setProgress] = useState<[number, number]>([0, 1]);
  const [error, setError] = useState<string | null>(null);
  const initialPage = Math.max(1, Number(search.get('page') ?? '1') || 1);

  useEffect(() => {
    let cancelled = false;
    setFile(null);
    setBytes(null);
    setError(null);
    void (async () => {
      try {
        const f = await fetchFile(id);
        if (cancelled) return;
        setFile(f);
        if (f.status !== 'ready') throw new Error('This upload didn’t finish. Delete it and upload the file again.');
        const b = await openFile(f, (d, t) => !cancelled && setProgress([d, t]));
        if (!cancelled) setBytes(b);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'This file couldn’t be opened.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const entries = useMemo<Entries | null>(() => {
    if (!bytes || !file || (file.kind !== 'docx' && file.kind !== 'pptx')) return null;
    try {
      return unzipSync(bytes);
    } catch {
      return null;
    }
  }, [bytes, file]);

  const download = () => {
    if (!bytes || !file) return;
    const url = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type: file.mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${file.title}${EXT[file.mime] ?? ''}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const remove = async () => {
    if (!file) return;
    try {
      await deleteFile(file.id);
      navigate('/library');
      toast.show({ message: `${file.title} moved to the trash`, action: { label: 'Undo', onAction: () => void restoreFile(file.id).then(() => navigate(`/files/${file.id}`)) } });
    } catch (e) {
      toast.show({ message: e instanceof Error ? e.message : 'Couldn’t delete the file.', tone: 'error' });
    }
  };

  const course = courses.find((c) => c.id === file?.courseId);

  let body: ReactNode = null;
  if (error) body = <p className="text-danger">{error}</p>;
  else if (!bytes || !file) {
    const pct = Math.round((progress[0] / Math.max(1, progress[1])) * 100);
    body = (
      <div className="flex flex-col gap-2">
        <p className="text-text-2">Downloading and decrypting… {pct}%</p>
        <span role="progressbar" aria-label="Opening file" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="block h-1.5 max-w-md overflow-hidden rounded-full bg-sunken">
          <span className="block h-full bg-accent" style={{ width: `${pct}%` }} />
        </span>
      </div>
    );
  } else if (file.kind === 'pdf') body = <PdfView bytes={bytes} initialPage={initialPage} />;
  else if (file.kind === 'image') body = <ImageView bytes={bytes} mime={file.mime} title={file.title} />;
  else if (file.kind === 'md') body = <MarkdownView text={new TextDecoder().decode(bytes)} />;
  else if (!entries) body = <p className="text-danger">This file couldn’t be unpacked. It may be damaged. Try downloading it.</p>;
  else body = file.kind === 'docx' ? <DocxView entries={entries} /> : <PptxView entries={entries} initialSlide={initialPage} />;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate('/library')}>
          ← Library
        </Button>
        <span className="flex gap-2">
          <Button size="sm" disabled={!bytes} onClick={download}>
            Download
          </Button>
          <Button size="sm" variant="danger" disabled={!file} onClick={() => void remove()}>
            Delete
          </Button>
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <h1 className="text-[2.125rem] leading-tight font-semibold break-words">{file?.title ?? 'Opening…'}</h1>
        {file ? (
          <p className="text-sm text-text-2">
            {file.origin === 'link' && file.kind === 'md' ? 'Web page' : KIND_LABEL[file.kind]} · {formatBytes(file.bytes)}
            {course ? ` · ${course.code ?? course.name}` : ''} · encrypted
          </p>
        ) : null}
      </div>
      {body}
    </div>
  );
}
