// Combobox (APG editable combobox with list autocomplete; DESIGN §5). Used for the school picker.
// Typing filters; Down/Up move the active option; Enter chooses; Escape closes (then clears).
// Focus stays in the text field and the active option is announced via aria-activedescendant.

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from './cx.ts';
import { nextIndex } from './keys.ts';

export type ComboboxProps<T> = {
  label: string;
  description?: string;
  placeholder?: string;
  query: string;
  onQueryChange: (q: string) => void;
  options: readonly T[];
  getKey: (o: T) => string;
  renderOption: (o: T) => ReactNode;
  /** Plain-text label read by screen readers for each option. */
  getLabel: (o: T) => string;
  onSelect: (o: T) => void;
  /** Shown under the list, e.g. a "Not listed?" action. */
  footer?: ReactNode;
  /** Text when the query has no matches. */
  emptyText?: string;
};

export function Combobox<T>({
  label, description, placeholder, query, onQueryChange, options, getKey, renderOption, getLabel, onSelect, footer, emptyText = 'No matches.',
}: ComboboxProps<T>) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const showList = open && query.trim().length >= 2;

  const choose = (i: number) => {
    const o = options[i];
    if (!o) return;
    onSelect(o);
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (open) setOpen(false);
      else onQueryChange('');
      return;
    }
    if (e.key === 'Enter') {
      if (showList && active >= 0) {
        e.preventDefault();
        choose(active);
      }
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) setOpen(true);
      const next = nextIndex(e.key, active, options.length, { loop: true });
      if (next !== null) setActive(next);
    }
  };

  const optionId = (i: number) => `${id}-opt-${i}`;

  return (
    <div className="relative flex flex-col gap-1.5">
      <label htmlFor={`${id}-input`} className="text-text">
        {label}
      </label>
      <input
        ref={inputRef}
        id={`${id}-input`}
        type="text"
        role="combobox"
        autoComplete="off"
        spellCheck={false}
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={`${id}-list`}
        aria-activedescendant={showList && active >= 0 ? optionId(active) : undefined}
        aria-describedby={description ? `${id}-desc` : undefined}
        placeholder={placeholder}
        value={query}
        onChange={(e) => {
          onQueryChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
        className="ds-target min-h-10 w-full rounded-md border border-border-strong bg-surface px-3 text-text placeholder:text-text-3"
      />
      {description ? (
        <p id={`${id}-desc`} className="text-sm text-text-2">
          {description}
        </p>
      ) : null}
      <div hidden={!showList} className="absolute top-full z-30 mt-1 w-full rounded-md border border-border bg-surface shadow-pop">
        <ul id={`${id}-list`} role="listbox" aria-label={label} className="max-h-80 overflow-auto py-1">
          {options.map((o, i) => (
            <li
              key={getKey(o)}
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              aria-label={getLabel(o)}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(i)}
              className={cx('cursor-pointer px-3 py-2', i === active && 'bg-accent-bg text-chip-text')}
            >
              {renderOption(o)}
            </li>
          ))}
        </ul>
        {options.length === 0 ? <p className="px-3 py-2 text-sm text-text-2">{emptyText}</p> : null}
        {footer ? (
          <div className="border-t border-border px-3 py-2" onMouseDown={(e) => e.preventDefault()}>
            {footer}
          </div>
        ) : null}
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {showList ? `${options.length} ${options.length === 1 ? 'result' : 'results'}` : ''}
      </p>
    </div>
  );
}
