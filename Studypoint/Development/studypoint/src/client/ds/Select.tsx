// Select (APG "select-only combobox" pattern; DESIGN §5). Replaces native <select> (AGENTS 17).
// Focus stays on the combobox; the active option is announced via aria-activedescendant.
// Keys: Down/Up/Home/End/PageUp/PageDown move, Enter/Space choose, Escape closes, letters type-ahead.

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { cx } from './cx.ts';
import { nextIndex, typeaheadIndex } from './keys.ts';

export type SelectOption<T extends string> = { value: T; label: string; disabled?: boolean };

export type SelectProps<T extends string> = {
  label: string;
  value: T | null;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  disabled?: boolean;
};

const TYPEAHEAD_RESET_MS = 500;

export function Select<T extends string>({ label, value, options, onChange, placeholder = 'Choose…', disabled = false }: SelectProps<T>) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const selected = options.findIndex((o) => o.value === value);
  const [active, setActive] = useState(selected);
  const rootRef = useRef<HTMLDivElement>(null);
  const buffer = useRef({ text: '', at: 0 });
  const disabledFlags = options.map((o) => !!o.disabled);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const openWith = (index: number) => {
    setActive(index);
    setOpen(true);
  };

  const choose = (index: number) => {
    const opt = options[index];
    if (!opt || opt.disabled) return;
    onChange(opt.value);
    setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' ', 'Home', 'End'].includes(e.key)) {
        e.preventDefault();
        const start = selected >= 0 ? selected : (nextIndex(e.key === 'ArrowUp' || e.key === 'End' ? 'End' : 'Home', -1, options.length, { disabled: disabledFlags }) ?? 0);
        openWith(start);
        return;
      }
    } else {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        choose(active);
        return;
      }
      if (e.key === 'Tab') {
        choose(active);
        return;
      }
      const next = nextIndex(e.key, active, options.length, { loop: false, disabled: disabledFlags });
      if (next !== null) {
        e.preventDefault();
        setActive(next);
        return;
      }
    }
    if (e.key.length === 1 && /\S/.test(e.key)) {
      const now = Date.now();
      buffer.current.text = now - buffer.current.at > TYPEAHEAD_RESET_MS ? e.key : buffer.current.text + e.key;
      buffer.current.at = now;
      const from = open ? active : selected;
      const hit = typeaheadIndex(buffer.current.text, options.map((o) => o.label), from, disabledFlags);
      if (hit !== null) {
        if (open) setActive(hit);
        else choose(hit);
      }
    }
  };

  const current = selected >= 0 ? options[selected] : undefined;
  const optionId = (i: number) => `${id}-opt-${i}`;

  return (
    <div ref={rootRef} className="relative flex flex-col gap-2">
      <span id={`${id}-label`} className="text-text">
        {label}
      </span>
      <div
        role="combobox"
        tabIndex={disabled ? -1 : 0}
        aria-labelledby={`${id}-label ${id}-value`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        aria-disabled={disabled || undefined}
        onKeyDown={onKeyDown}
        onClick={() => !disabled && (open ? setOpen(false) : openWith(selected >= 0 ? selected : 0))}
        className={cx(
          'ds-target flex min-h-10 cursor-pointer items-center justify-between gap-2 rounded-md border border-border-strong bg-surface px-3',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        <span id={`${id}-value`} className={current ? 'text-text' : 'text-text-3'}>
          {current ? current.label : placeholder}
        </span>
        <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4 text-text-2" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <ul
        id={`${id}-listbox`}
        role="listbox"
        aria-labelledby={`${id}-label`}
        hidden={!open}
        className="absolute top-full z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-surface py-1 shadow-pop"
      >
        {options.map((o, i) => (
          <li
            key={o.value}
            id={optionId(i)}
            role="option"
            aria-selected={i === selected}
            aria-disabled={o.disabled || undefined}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => !o.disabled && setActive(i)}
            onClick={() => choose(i)}
            className={cx(
              'flex min-h-9 cursor-pointer items-center justify-between px-3',
              i === active && 'bg-accent-bg text-chip-text',
              o.disabled && 'cursor-not-allowed opacity-50',
            )}
          >
            <span>{o.label}</span>
            {i === selected ? (
              <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M3 8.5l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
