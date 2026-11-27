// TextField and TextArea (DESIGN §5 "Inputs"). Labels are always visible (never placeholder-only),
// help and error text are linked with aria-describedby, and errors set aria-invalid.
// Only text-like input types are allowed here; number/date/etc. have their own components (AGENTS 17).

import { useId, useLayoutEffect, useRef, type InputHTMLAttributes, type ReactNode, type Ref, type TextareaHTMLAttributes } from 'react';
import { cx } from './cx.ts';

type FieldChrome = {
  label: string;
  /** Helper text under the field. */
  description?: string;
  /** Error message; when set the field is marked invalid and the message is announced. */
  error?: string | null;
  /** Visually marks the field as required and sets aria-required. */
  required?: boolean;
};

const FIELD = cx(
  'w-full rounded-md border bg-surface px-3 text-text placeholder:text-text-3',
  'transition-colors duration-[var(--dur-fast)] disabled:cursor-not-allowed disabled:opacity-50',
);

function Chrome({ id, label, description, error, required, children }: FieldChrome & { id: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-text">
        {label}
        {required ? (
          <span aria-hidden="true" className="ml-1 text-danger">
            *
          </span>
        ) : null}
      </label>
      {children}
      {description ? (
        <p id={`${id}-desc`} className="text-sm text-text-2">
          {description}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-err`} className="flex items-center gap-1.5 text-sm text-danger">
          <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="8" cy="8" r="6.5" />
            <path d="M8 4.5v4M8 11v.5" strokeLinecap="round" />
          </svg>
          {error}
        </p>
      ) : null}
    </div>
  );
}

const describedBy = (id: string, description?: string, error?: string | null) =>
  [description ? `${id}-desc` : null, error ? `${id}-err` : null].filter(Boolean).join(' ') || undefined;

export type TextFieldProps = FieldChrome &
  Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'id' | 'required'> & {
    type?: 'text' | 'email' | 'search' | 'url' | 'password' | 'tel';
    ref?: Ref<HTMLInputElement>;
  };

export function TextField({ label, description, error, required, type = 'text', className, ...rest }: TextFieldProps) {
  const id = useId();
  return (
    <Chrome id={id} label={label} description={description} error={error} required={required}>
      <input
        {...rest}
        id={id}
        type={type}
        required={required}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, description, error)}
        className={cx(FIELD, 'ds-target min-h-10', error ? 'border-danger' : 'border-border-strong', className)}
      />
    </Chrome>
  );
}

export type TextAreaProps = FieldChrome &
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id' | 'required'> & {
    /** Grow with content up to this many rows (then scroll). */
    maxRows?: number;
  };

export function TextArea({ label, description, error, required, rows = 3, maxRows = 12, className, value, ...rest }: TextAreaProps) {
  const id = useId();
  const ref = useRef<HTMLTextAreaElement>(null);

  // Auto-size: grow to fit, never smaller than `rows`, capped at maxRows. While the field is hidden
  // (e.g. inside a dialog that hasn't opened yet) it has no layout and scrollHeight is 0, so measuring
  // then would collapse it to a sliver; the min-height below keeps it at `rows` lines regardless.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const line = parseFloat(getComputedStyle(el).lineHeight) || 24;
    const min = line * rows + 16;
    const max = line * maxRows + 16;
    el.style.minHeight = `${min}px`;
    el.style.height = 'auto';
    if (el.scrollHeight === 0) {
      el.style.height = `${min}px`;
      return;
    }
    el.style.height = `${Math.min(Math.max(el.scrollHeight, min), max)}px`;
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
  }, [value, rows, maxRows]);

  return (
    <Chrome id={id} label={label} description={description} error={error} required={required}>
      <textarea
        {...rest}
        ref={ref}
        id={id}
        rows={rows}
        value={value}
        required={required}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, description, error)}
        className={cx(FIELD, 'resize-none py-2 leading-relaxed', error ? 'border-danger' : 'border-border-strong', className)}
      />
    </Chrome>
  );
}
