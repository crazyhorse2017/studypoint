// Switch and Checkbox (DESIGN §5 "Inputs"). Custom controls on <button> with the APG roles,
// so they're focusable, toggle on Space/Enter and announce state. No native checkbox inputs (AGENTS 17).

import { useId } from 'react';
import { cx } from './cx.ts';

export type SwitchProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  /** Optional helper text, linked with aria-describedby. */
  description?: string;
  disabled?: boolean;
};

export function Switch({ checked, onChange, label, description, disabled = false }: SwitchProps) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="flex flex-col">
        <span id={`${id}-label`} className="text-text">
          {label}
        </span>
        {description ? (
          <span id={`${id}-desc`} className="text-sm text-text-2">
            {description}
          </span>
        ) : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={description ? `${id}-desc` : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'ds-target relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-border-strong',
          'transition-colors duration-[var(--dur-fast)] disabled:cursor-not-allowed disabled:opacity-50',
          checked ? 'bg-accent' : 'bg-sunken',
        )}
      >
        <span
          aria-hidden="true"
          className={cx(
            'inline-block h-4 w-4 rounded-full shadow-sm transition-transform duration-[var(--dur-fast)]',
            checked ? 'translate-x-6 bg-on-accent' : 'translate-x-1 bg-text-2',
          )}
        />
      </button>
    </div>
  );
}

export type CheckboxState = boolean | 'mixed';

export type CheckboxProps = {
  checked: CheckboxState;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
};

export function Checkbox({ checked, onChange, label, disabled = false }: CheckboxProps) {
  const id = useId();
  const on = checked === true;
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        disabled={disabled}
        onClick={() => onChange(checked !== true)}
        className={cx(
          'ds-target inline-flex h-5 w-5 items-center justify-center rounded-sm border border-border-strong',
          'disabled:cursor-not-allowed disabled:opacity-50',
          on || checked === 'mixed' ? 'bg-accent text-on-accent' : 'bg-surface',
        )}
      >
        {on ? (
          <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M3 8.5l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : checked === 'mixed' ? (
          <span aria-hidden="true" className="h-0.5 w-2.5 bg-on-accent" />
        ) : null}
      </button>
      <span id={`${id}-label`} className="text-text" onClick={() => !disabled && onChange(checked !== true)}>
        {label}
      </span>
    </span>
  );
}
