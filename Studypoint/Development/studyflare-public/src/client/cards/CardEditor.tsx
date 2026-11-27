// Make or edit a card (CRD-01): Front & back, Typed answer, Fill in the blank, Image occlusion.
// Math works like everywhere else: type backslash commands (\frac{a}{b}); the preview renders them.

import { useRef, useState } from 'react';
import { Button, SegmentedControl, Switch, TextArea, useToast } from '../ds/index.ts';
import { clozeNumbers, payloadProblem, type CardPayload } from '../../shared/cards.ts';
import { CardFace } from './CardFace.tsx';
import { OcclusionEditor, type OcclusionDraft } from './OcclusionEditor.tsx';
import { createCard, updateCard } from './cardsApi.ts';

type Kind = 'basic' | 'typed' | 'cloze' | 'occlusion';

const KINDS: ReadonlyArray<{ value: Kind; label: string }> = [
  { value: 'basic', label: 'Front & back' },
  { value: 'typed', label: 'Typed answer' },
  { value: 'cloze', label: 'Fill in the blank' },
  { value: 'occlusion', label: 'Image occlusion' },
];

function kindOf(p: CardPayload | null): Kind {
  if (!p) return 'basic';
  if (p.type === 'basic') return p.answerMode === 'typed' ? 'typed' : 'basic';
  return p.type;
}

export function CardEditor({ courseId, editing, onDone }: { courseId: string; editing?: { id: string; payload: CardPayload } | null; onDone: () => void }) {
  const toast = useToast();
  const init = editing?.payload ?? null;
  const [kind, setKind] = useState<Kind>(kindOf(init));
  const [front, setFront] = useState(init?.type === 'basic' ? init.front : '');
  const [back, setBack] = useState(init?.type === 'basic' ? init.back : '');
  const [reversible, setReversible] = useState(init?.type === 'basic' ? init.reversible : false);
  const [cloze, setCloze] = useState(init?.type === 'cloze' ? init.text : '');
  const [extra, setExtra] = useState(init?.type === 'cloze' ? init.extra : '');
  const [occ, setOcc] = useState<OcclusionDraft>(
    init?.type === 'occlusion' ? { fileId: init.fileId, page: init.page, masks: init.masks, caption: init.caption, mode: init.mode } : { fileId: null, page: null, masks: [], caption: '', mode: 'hide-one' },
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(false);
  const clozeBox = useRef<HTMLDivElement>(null);

  const payload = (): CardPayload | null => {
    if (kind === 'basic' || kind === 'typed') return { type: 'basic', front, back, reversible: kind === 'basic' && reversible, answerMode: kind === 'typed' ? 'typed' : 'reveal' };
    if (kind === 'cloze') return { type: 'cloze', text: cloze, extra };
    if (!occ.fileId) return null;
    return { type: 'occlusion', fileId: occ.fileId, page: occ.page, masks: occ.masks, caption: occ.caption, mode: occ.mode };
  };

  /** Wrap the selected text of the cloze box in the next blank: "{{cN::selection}}". */
  const makeBlank = () => {
    const ta = clozeBox.current?.querySelector('textarea');
    if (!ta) return;
    const { selectionStart: s, selectionEnd: e } = ta;
    const n = Math.max(0, ...clozeNumbers(cloze)) + 1;
    const chosen = cloze.slice(s, e) || 'answer';
    const next = `${cloze.slice(0, s)}{{c${n}::${chosen}}}${cloze.slice(e)}`;
    setCloze(next);
    requestAnimationFrame(() => {
      ta.focus();
      const end = s + `{{c${n}::${chosen}}}`.length;
      ta.setSelectionRange(end, end);
    });
  };

  const save = async (andNew: boolean) => {
    setError(null);
    const p = payload();
    if (!p) return setError('Choose a picture or PDF first.');
    const problem = payloadProblem(p);
    if (problem) return setError(problem);
    if (p.type === 'occlusion' && p.masks.some((m) => !m.label.trim())) return setError('Give every box an answer, so you can check yourself.');
    setSaving(true);
    try {
      if (editing) await updateCard(editing.id, p);
      else await createCard(courseId, p);
      toast.show({ message: editing ? 'Card saved' : 'Card added' });
      if (andNew && !editing) {
        setFront('');
        setBack('');
        setCloze('');
        setExtra('');
        setOcc({ ...occ, masks: [] });
        setPreview(false);
      } else onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t save the card.');
    } finally {
      setSaving(false);
    }
  };

  const p = payload();
  const firstVariant = p ? (p.type === 'basic' ? 'main' : p.type === 'cloze' ? `c${clozeNumbers(p.text)[0] ?? 1}` : `m:${p.masks[0]?.id ?? ''}`) : 'main';

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
      {!editing ? <SegmentedControl label="Card type" value={kind} options={KINDS} onChange={(k) => { setKind(k); setError(null); }} /> : null}
      {kind === 'basic' || kind === 'typed' ? (
        <>
          <TextArea label="Front" value={front} onChange={(e) => setFront(e.target.value)} placeholder="Question. Math: \frac{dy}{dx}, \alpha, \sqrt{x}" />
          <TextArea label={kind === 'typed' ? 'Answer to type' : 'Back'} value={back} onChange={(e) => setBack(e.target.value)} rows={kind === 'typed' ? 1 : 3}
            description={kind === 'typed' ? 'Checked forgivingly: case, spacing and accents don’t matter; numbers count within 1%.' : undefined} />
          {kind === 'basic' ? <Switch checked={reversible} onChange={setReversible} label="Also ask it the other way round" description="Adds a second card: back → front." /> : null}
        </>
      ) : kind === 'cloze' ? (
        <>
          <div ref={clozeBox}>
            <TextArea label="Text with blanks" value={cloze} onChange={(e) => setCloze(e.target.value)} rows={4}
              description="Select words and press Make blank. Each number is its own card: {{c1::…}}, {{c2::…}}. Add a hint with {{c1::answer::hint}}." />
          </div>
          <div>
            <Button size="sm" onMouseDown={(e) => e.preventDefault()} onClick={makeBlank}>
              Make blank
            </Button>
          </div>
          <TextArea label="Extra (shown with the answer, optional)" value={extra} onChange={(e) => setExtra(e.target.value)} rows={2} />
        </>
      ) : (
        <OcclusionEditor courseId={courseId} draft={occ} onChange={setOcc} />
      )}

      {p && !payloadProblem(p) ? (
        <div className="flex flex-col gap-2">
          <Button size="sm" variant="ghost" aria-expanded={preview} onClick={() => setPreview((v) => !v)}>
            {preview ? 'Hide preview' : 'Preview'}
          </Button>
          {preview ? (
            <div className="rounded-md border border-dashed border-border-strong p-4">
              <CardFace payload={p} variant={firstVariant} revealed />
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" loading={saving} onClick={() => void save(false)}>
          {editing ? 'Save card' : 'Add card'}
        </Button>
        {!editing ? (
          <Button loading={saving} onClick={() => void save(true)}>
            Add and make another
          </Button>
        ) : null}
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
