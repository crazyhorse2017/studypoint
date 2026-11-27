// The note editor (LIB-08): rich text with a toolbar, and math rendered by KaTeX (MathML included for
// screen readers). Type $x^2$ for inline math, or use the toolbar. Saves automatically, encrypted, about a
// second after you stop typing. Loaded lazily, so the editor code only downloads when a note is opened.

import { useCallback, useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import { nodeInputRule } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { BlockMath, InlineMath } from '@tiptap/extension-mathematics';
import { Placeholder } from '@tiptap/extensions';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { Button, Dialog, Select, TextArea, useToast } from '../ds/index.ts';
import { navigate } from '../router.ts';
import { useStudy } from '../studyStore.ts';
import { deleteNote, loadNote, restoreNote, saveNote, type JsonDoc, type OpenNote } from './notesApi.ts';

const KATEX = { throwOnError: false, output: 'htmlAndMathml' as const, trust: false };
const SAVE_DELAY_MS = 1200;

type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'error' | 'conflict';
const STATUS_TEXT: Record<SaveStatus, string> = {
  saved: 'Saved · encrypted',
  unsaved: 'Unsaved changes',
  saving: 'Saving…',
  error: 'Couldn’t save. Retrying when you type again.',
  conflict: 'Changed somewhere else.',
};

type MathEdit = { kind: 'inline' | 'block'; latex: string; pos: number | null };

/** Inline math from "$…$" as you type (not "$$", and not an escaped "\$"). */
const DollarInlineMath = InlineMath.extend({
  addInputRules() {
    return [
      nodeInputRule({
        find: /(?<![$\\])\$[^$\n]+\$$/,
        type: this.type,
        getAttributes: (match) => ({ latex: match[0].slice(1, -1) }),
      }),
    ];
  },
});

function MathPreview({ latex, block }: { latex: string; block: boolean }) {
  const html = latex.trim() === '' ? '' : katex.renderToString(latex, { ...KATEX, displayMode: block });
  return (
    <div className="min-h-12 rounded-md border border-border bg-sunken p-3 text-text" aria-live="polite">
      {html ? <span dangerouslySetInnerHTML={{ __html: html }} /> : <span className="text-text-3">Preview appears here</span>}
    </div>
  );
}

function Toolbar({ editor, onMath }: { editor: Editor; onMath: (kind: 'inline' | 'block') => void }) {
  const s = useEditorState({
    editor,
    selector: (ctx) => ({
      bold: ctx.editor.isActive('bold'),
      italic: ctx.editor.isActive('italic'),
      h2: ctx.editor.isActive('heading', { level: 2 }),
      h3: ctx.editor.isActive('heading', { level: 3 }),
      bullet: ctx.editor.isActive('bulletList'),
      ordered: ctx.editor.isActive('orderedList'),
      code: ctx.editor.isActive('code'),
      quote: ctx.editor.isActive('blockquote'),
      canUndo: ctx.editor.can().undo(),
      canRedo: ctx.editor.can().redo(),
    }),
  });
  const btn = (label: string, short: string, pressed: boolean | null, run: () => void, disabled = false) => (
    <Button
      size="sm"
      variant={pressed ? 'secondary' : 'ghost'}
      aria-label={label}
      aria-pressed={pressed === null ? undefined : pressed}
      title={label}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      {short}
    </Button>
  );
  const chain = () => editor.chain().focus();
  return (
    <div role="toolbar" aria-label="Formatting" className="sticky top-14 z-10 flex flex-wrap gap-1 border-b border-border bg-page/95 py-2 backdrop-blur-sm">
      {btn('Bold (Ctrl+B)', 'B', s.bold, () => chain().toggleBold().run())}
      {btn('Italic (Ctrl+I)', 'I', s.italic, () => chain().toggleItalic().run())}
      {btn('Heading', 'H2', s.h2, () => chain().toggleHeading({ level: 2 }).run())}
      {btn('Subheading', 'H3', s.h3, () => chain().toggleHeading({ level: 3 }).run())}
      {btn('Bulleted list', '• List', s.bullet, () => chain().toggleBulletList().run())}
      {btn('Numbered list', '1. List', s.ordered, () => chain().toggleOrderedList().run())}
      {btn('Quote', '“ Quote', s.quote, () => chain().toggleBlockquote().run())}
      {btn('Inline code', '</>', s.code, () => chain().toggleCode().run())}
      {btn('Inline math', '∑ Math', null, () => onMath('inline'))}
      {btn('Equation on its own line', '∑ Equation', null, () => onMath('block'))}
      {btn('Undo (Ctrl+Z)', 'Undo', null, () => chain().undo().run(), !s.canUndo)}
      {btn('Redo (Ctrl+Shift+Z)', 'Redo', null, () => chain().redo().run(), !s.canRedo)}
    </div>
  );
}

function Loaded({ note }: { note: OpenNote }) {
  const toast = useToast();
  const { courses } = useStudy();
  const [title, setTitle] = useState(note.title);
  const [courseId, setCourseId] = useState<string | null>(note.courseId);
  const [status, setStatus] = useState<SaveStatus>('saved');
  const [math, setMath] = useState<MathEdit | null>(null);
  const base = useRef(note.updatedAt);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef(false);
  const again = useRef(false);
  const latest = useRef({ title: note.title, courseId: note.courseId });
  const editorRef = useRef<Editor | null>(null);

  const save = useCallback(async () => {
    const ed = editorRef.current;
    if (!ed) return;
    if (saving.current) {
      again.current = true;
      return;
    }
    saving.current = true;
    setStatus('saving');
    try {
      base.current = await saveNote(note.id, { title: latest.current.title.trim(), courseId: latest.current.courseId, doc: ed.getJSON() as JsonDoc }, base.current);
      setStatus('saved');
    } catch (e) {
      const conflict = e instanceof Error && 'status' in e && (e as { status: number }).status === 409;
      setStatus(conflict ? 'conflict' : 'error');
      again.current = false;
    } finally {
      saving.current = false;
    }
    if (again.current) {
      again.current = false;
      void save();
    }
  }, [note.id]);

  const schedule = useCallback(() => {
    setStatus((s) => (s === 'conflict' ? s : 'unsaved'));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), SAVE_DELAY_MS);
  }, [save]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] }, link: { openOnClick: false, autolink: true } }),
      DollarInlineMath.configure({ katexOptions: KATEX, onClick: (node, pos) => setMath({ kind: 'inline', latex: String(node.attrs['latex'] ?? ''), pos }) }),
      BlockMath.configure({ katexOptions: { ...KATEX, displayMode: true }, onClick: (node, pos) => setMath({ kind: 'block', latex: String(node.attrs['latex'] ?? ''), pos }) }),
      Placeholder.configure({ placeholder: 'Start writing. Type $x^2$ for math.' }),
    ],
    content: note.doc,
    editorProps: { attributes: { class: 'note-body reading','aria-label': 'Note text', 'aria-multiline': 'true' } },
    onUpdate: () => schedule(),
  });
  editorRef.current = editor;

  // Save right away when the tab is hidden or the page is left, so nothing waits on the timer.
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === 'hidden' && timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
        void save();
      }
    };
    document.addEventListener('visibilitychange', flush);
    return () => {
      document.removeEventListener('visibilitychange', flush);
      if (timer.current) {
        clearTimeout(timer.current);
        void save();
      }
    };
  }, [save]);

  const applyMath = () => {
    if (!math || !editor) return;
    const latex = math.latex.trim();
    const c = editor.chain().focus();
    if (math.pos === null) {
      if (latex) (math.kind === 'inline' ? c.insertInlineMath({ latex }) : c.insertBlockMath({ latex })).run();
    } else if (latex === '') {
      (math.kind === 'inline' ? c.deleteInlineMath({ pos: math.pos }) : c.deleteBlockMath({ pos: math.pos })).run();
    } else {
      (math.kind === 'inline' ? c.updateInlineMath({ latex, pos: math.pos }) : c.updateBlockMath({ latex, pos: math.pos })).run();
    }
    setMath(null);
  };

  const remove = async () => {
    try {
      if (timer.current) clearTimeout(timer.current);
      await deleteNote(note.id);
      navigate('/library');
      toast.show({ message: 'Note moved to the trash', action: { label: 'Undo', onAction: () => void restoreNote(note.id).then(() => navigate(`/notes/${note.id}`)) } });
    } catch (e) {
      toast.show({ message: e instanceof Error ? e.message : 'Couldn’t delete the note.', tone: 'error' });
    }
  };

  const courseOptions = [{ value: 'none', label: 'No course' }, ...courses.filter((c) => !c.archived || c.id === courseId).map((c) => ({ value: c.id, label: c.code ? `${c.code} · ${c.name}` : c.name }))];

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate('/library')}>
          ← Library
        </Button>
        <p role="status" aria-live="polite" className="text-sm text-text-2">
          {STATUS_TEXT[status]}
          {status === 'conflict' ? (
            <Button variant="ghost" size="sm" className="ml-2" onClick={() => window.location.reload()}>
              Reload latest
            </Button>
          ) : null}
        </p>
      </div>
      <h1 className="sr-only">{title.trim() || 'Untitled note'}</h1>
      <input
        aria-label="Note title"
        className="w-full rounded-sm bg-transparent text-[2.125rem] leading-tight font-semibold text-text placeholder:text-text-3"
        placeholder="Untitled note"
        value={title}
        maxLength={200}
        onChange={(e) => {
          setTitle(e.target.value);
          latest.current.title = e.target.value;
          schedule();
        }}
      />
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-64">
          <Select
            label="Course"
            value={courseId ?? 'none'}
            options={courseOptions}
            onChange={(v) => {
              const next = v === 'none' ? null : v;
              setCourseId(next);
              latest.current.courseId = next;
              schedule();
            }}
          />
        </div>
        <Button variant="danger" size="sm" onClick={() => void remove()}>
          Delete note
        </Button>
      </div>
      {editor ? <Toolbar editor={editor} onMath={(kind) => setMath({ kind, latex: '', pos: null })} /> : null}
      <EditorContent editor={editor} className="min-h-[50vh] text-text" />
      <Dialog
        open={math !== null}
        onClose={() => setMath(null)}
        title={math?.kind === 'block' ? 'Equation' : 'Inline math'}
        description="Write LaTeX, for example \frac{dy}{dx} = 3x^2. Leave it empty to remove the math."
        actions={
          <>
            <Button variant="ghost" onClick={() => setMath(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={applyMath}>
              {math?.pos === null ? 'Insert' : 'Update'}
            </Button>
          </>
        }
      >
        {math ? (
          <div className="flex flex-col gap-3">
            <TextArea label="LaTeX" value={math.latex} onChange={(e) => setMath({ ...math, latex: e.target.value })} className="font-mono" autoFocus />
            <MathPreview latex={math.latex} block={math.kind === 'block'} />
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}

export default function NotePage({ id }: { id: string }) {
  const [note, setNote] = useState<OpenNote | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setNote(null);
    setError(null);
    loadNote(id).then(setNote, (e) => setError(e instanceof Error ? e.message : 'This note couldn’t be opened.'));
  }, [id]);
  if (error) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <h1 className="text-[2.125rem] leading-tight font-semibold">Note not available</h1>
        <p className="text-text-2">{error}</p>
        <div>
          <Button onClick={() => navigate('/library')}>Back to Library</Button>
        </div>
      </div>
    );
  }
  if (!note) return <p className="text-text-2">Opening and decrypting…</p>;
  return <Loaded key={note.id} note={note} />;
}
