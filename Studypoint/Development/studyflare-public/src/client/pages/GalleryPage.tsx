// Design-system gallery (DESIGN §5). Dev and preview builds ONLY: App.tsx loads it behind
// import.meta.env.VITE_DS_GALLERY, so production bundles don't contain it (LIB-12). Generic placeholder text only.

import { useState } from 'react';
import {
  Button, Checkbox, ConfirmDialog, Dialog, FileDrop, IconButton, Menu, RadioGroup, SegmentedControl, Select, Slider,
  Switch, Tabs, TextArea, TextField, Tooltip, useToast,
} from '../ds/index.ts';

const plus = (
  <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M8 3v10M3 8h10" strokeLinecap="round" />
  </svg>
);

export default function GalleryPage() {
  const toast = useToast();
  const [on, setOn] = useState(true);
  const [check, setCheck] = useState<boolean>(false);
  const [slider, setSlider] = useState(20);
  const [seg, setSeg] = useState<'a' | 'b' | 'c'>('a');
  const [sel, setSel] = useState<'one' | 'two' | 'three' | null>(null);
  const [radio, setRadio] = useState<'x' | 'y' | null>('x');
  const [tab, setTab] = useState<'first' | 'second'>('first');
  const [text, setText] = useState('');
  const [dialog, setDialog] = useState(false);
  const [confirm, setConfirm] = useState(false);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-10">
      <h1 className="text-[2.125rem] font-semibold">Component gallery</h1>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Buttons</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary">Primary</Button>
          <Button>Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Delete</Button>
          <Button loading>Saving</Button>
          <Button disabled>Disabled</Button>
          <Tooltip content="Add an item">
            <IconButton label="Add" icon={plus} />
          </Tooltip>
          <Menu
            trigger="More"
            items={[
              { label: 'Rename', onSelect: () => toast.show({ message: 'Rename chosen' }) },
              { label: 'Duplicate', onSelect: () => toast.show({ message: 'Duplicate chosen' }) },
              { label: 'Delete', destructive: true, onSelect: () => setConfirm(true) },
            ]}
          />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">Inputs</h2>
        <TextField label="Name" description="Helper text sits here." value={text} onChange={(e) => setText(e.target.value)} />
        <TextField label="Required with error" required error="Enter a value." defaultValue="" />
        <TextArea label="Notes" placeholder="Write something" />
        <Switch label="A setting" description="With a description." checked={on} onChange={setOn} />
        <Checkbox label="A checkbox" checked={check} onChange={setCheck} />
        <Slider label="Minutes" value={slider} min={5} max={120} step={5} format={(v) => `${v} minutes`} onChange={setSlider} />
        <SegmentedControl label="Segments" value={seg} onChange={setSeg} options={[{ value: 'a', label: 'One' }, { value: 'b', label: 'Two' }, { value: 'c', label: 'Three' }]} />
        <Select label="Select" value={sel} onChange={setSel} options={[{ value: 'one', label: 'Option one' }, { value: 'two', label: 'Option two' }, { value: 'three', label: 'Option three', disabled: true }]} />
        <RadioGroup label="Radios" value={radio} onChange={setRadio} options={[{ value: 'x', label: 'First choice', description: 'Explains the first choice.' }, { value: 'y', label: 'Second choice' }]} />
        <FileDrop label="Add files" onFiles={(f) => toast.show({ message: `${f.length} file(s) accepted` })} onRejected={(r) => toast.show({ message: r.join(' '), tone: 'error' })} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Tabs, dialogs, toasts</h2>
        <Tabs label="Example tabs" value={tab} onChange={setTab} tabs={[{ value: 'first', label: 'First', panel: <p>First panel.</p> }, { value: 'second', label: 'Second', panel: <p>Second panel.</p> }]} />
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setDialog(true)}>Open dialog</Button>
          <Button onClick={() => setConfirm(true)}>Open confirm</Button>
          <Button onClick={() => toast.show({ message: 'Saved' })}>Toast</Button>
          <Button onClick={() => toast.show({ message: 'Item deleted', action: { label: 'Undo', onAction: () => toast.show({ message: 'Restored' }) } })}>Undo toast</Button>
          <Button onClick={() => toast.show({ message: 'Something failed', tone: 'error' })}>Error toast</Button>
        </div>
        <Dialog open={dialog} onClose={() => setDialog(false)} title="Example dialog" description="Dialogs trap focus and close with Escape." actions={<Button variant="primary" onClick={() => setDialog(false)}>Done</Button>}>
          <TextField label="Field inside a dialog" />
        </Dialog>
        <ConfirmDialog open={confirm} title="Delete “Sample source”?" message="You can undo this for 30 days." confirmLabel="Delete" destructive onConfirm={() => { setConfirm(false); toast.show({ message: 'Deleted', action: { label: 'Undo', onAction: () => {} } }); }} onCancel={() => setConfirm(false)} />
      </section>
    </div>
  );
}
