// Dialog and ConfirmDialog (APG dialog-modal; DESIGN §5 "Overlays").
// Built on the platform <dialog> with showModal(): the rest of the page becomes inert, focus is
// trapped, and Escape closes. We add labelling, initial focus and returning focus to the trigger.
// ConfirmDialog replaces window.confirm() (AGENTS 17).

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Button } from './Button.tsx';
import { cx } from './cx.ts';

export type DialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Optional one-line description, linked with aria-describedby. */
  description?: string;
  children?: ReactNode;
  /** Footer actions (buttons). */
  actions?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
};

const WIDTH = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' } as const;

export function Dialog({ open, onClose, title, description, children, actions, size = 'md' }: DialogProps) {
  const id = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      el.showModal();
      // Focus the first field or action rather than the dialog edge (APG).
      const first = el.querySelector<HTMLElement>('[data-autofocus], input, textarea, [role="combobox"], button:not([data-dialog-close])');
      first?.focus();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onNativeClose = () => {
      returnTo.current?.focus();
      returnTo.current = null;
    };
    const onCancel = (e: Event) => {
      // Escape: let the parent decide (it owns `open`).
      e.preventDefault();
      onClose();
    };
    el.addEventListener('close', onNativeClose);
    el.addEventListener('cancel', onCancel);
    return () => {
      el.removeEventListener('close', onNativeClose);
      el.removeEventListener('cancel', onCancel);
    };
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-title`}
      aria-describedby={description ? `${id}-desc` : undefined}
      onClick={(e) => {
        // A click on the backdrop (the dialog element itself, outside the panel) closes it.
        if (e.target === e.currentTarget) onClose();
      }}
      className={cx('ds-dialog w-[calc(100%-2rem)] rounded-lg border border-border bg-surface p-0 text-text shadow-pop', WIDTH[size])}
    >
      <div className="flex flex-col gap-4 p-6">
        <div className="flex items-start justify-between gap-4">
          <h2 id={`${id}-title`} className="text-lg font-semibold">
            {title}
          </h2>
          <button
            type="button"
            data-dialog-close
            aria-label="Close"
            onClick={onClose}
            className="ds-target -mr-2 -mt-1 inline-flex h-8 w-8 items-center justify-center rounded-md text-text-2 hover:bg-sunken"
          >
            <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {description ? (
          <p id={`${id}-desc`} className="text-text-2">
            {description}
          </p>
        ) : null}
        {children}
        {actions ? <div className="flex flex-wrap justify-end gap-2">{actions}</div> : null}
      </div>
    </dialog>
  );
}

export type ConfirmDialogProps = {
  open: boolean;
  title: string;
  /** Say what will happen and name the object, e.g. "Delete “Thermo notes”? You can undo this for 30 days." */
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({ open, title, message, confirmLabel, cancelLabel = 'Cancel', destructive = false, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      description={message}
      size="sm"
      actions={
        <>
          {/* Cancel gets initial focus, so Enter never confirms a destructive action by accident. */}
          <Button variant="secondary" onClick={onCancel} data-autofocus>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
