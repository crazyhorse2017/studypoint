// FileDrop (DESIGN §5): drag-and-drop, paste, or a "Choose files" button. The hidden <input type="file">
// here is the ONLY native file input allowed in the app (AGENTS 17, enforced by verify_repo.py),
// because it's the only way to open the operating system's file picker.

import { useId, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { Button } from './Button.tsx';
import { cx } from './cx.ts';
import { LIBRARY_UPLOAD_TYPES, partitionFiles } from './fileRules.ts';

export type FileDropProps = {
  label: string;
  /** Called with the files that passed the client-side checks. */
  onFiles: (files: File[]) => void;
  /** Called with plain-language reasons for files that were refused. */
  onRejected?: (reasons: string[]) => void;
  accept?: readonly string[];
  multiple?: boolean;
  disabled?: boolean;
};

export function FileDrop({ label, onFiles, onRejected, accept = LIBRARY_UPLOAD_TYPES, multiple = true, disabled = false }: FileDropProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const take = (list: FileList | null) => {
    if (!list || disabled) return;
    const files = Array.from(list).slice(0, multiple ? undefined : 1);
    const { accepted, rejected } = partitionFiles(files, accept);
    if (rejected.length > 0) onRejected?.(rejected);
    if (accepted.length > 0) onFiles(accepted);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setOver(false);
    take(e.dataTransfer.files);
  };

  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    if (e.clipboardData.files.length > 0) {
      e.preventDefault();
      take(e.clipboardData.files);
    }
  };

  const types = accept.map((a) => a.slice(1).toUpperCase()).join(', ');

  return (
    <div
      role="group"
      aria-labelledby={`${id}-label`}
      aria-describedby={`${id}-hint`}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      onPaste={onPaste}
      className={cx(
        'flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-10 text-center',
        over ? 'border-accent bg-accent-bg' : 'border-border-strong bg-sunken',
        disabled && 'opacity-50',
      )}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-8 w-8 text-text-2" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M12 16V4m0 0l-4 4m4-4l4 4M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <p id={`${id}-label`} className="text-text">
        {label}
      </p>
      <p id={`${id}-hint`} className="text-sm text-text-2">
        Drop files here, paste them, or choose from your computer. {types}, up to 100 MB each.
      </p>
      <Button variant="secondary" disabled={disabled} onClick={() => inputRef.current?.click()}>
        Choose files
      </Button>
      <input
        ref={inputRef}
        type="file"
        hidden
        tabIndex={-1}
        aria-hidden="true"
        multiple={multiple}
        accept={accept.join(',')}
        onChange={(e) => {
          take(e.currentTarget.files);
          e.currentTarget.value = ''; // allow choosing the same file again
        }}
      />
    </div>
  );
}
