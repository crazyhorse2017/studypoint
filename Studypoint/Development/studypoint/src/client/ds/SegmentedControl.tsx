// SegmentedControl (APG radio group; DESIGN §5). Roving tabindex: one Tab stop, arrows move and select.

import { useId, useRef, type KeyboardEvent } from 'react';
import { cx } from './cx.ts';
import { nextIndex } from './keys.ts';

export type Segment<T extends string> = { value: T; label: string; disabled?: boolean };

export type SegmentedControlProps<T extends string> = {
  label: string;
  value: T;
  options: readonly Segment<T>[];
  onChange: (value: T) => void;
};

export function SegmentedControl<T extends string>({ label, value, options, onChange }: SegmentedControlProps<T>) {
  const id = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const selected = Math.max(0, options.findIndex((o) => o.value === value));

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const horizontal = nextIndex(e.key, selected, options.length, { orientation: 'horizontal', disabled: options.map((o) => !!o.disabled) });
    // APG radio groups also accept Up/Down.
    const vertical = nextIndex(e.key, selected, options.length, { orientation: 'vertical', disabled: options.map((o) => !!o.disabled) });
    const next = horizontal ?? (e.key === 'ArrowUp' || e.key === 'ArrowDown' ? vertical : null);
    if (next === null) return;
    e.preventDefault();
    const opt = options[next];
    if (opt) {
      onChange(opt.value);
      refs.current[next]?.focus();
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <span id={`${id}-label`} className="text-text">
        {label}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={`${id}-label`}
        onKeyDown={onKeyDown}
        className="inline-flex w-fit rounded-md border border-border-strong bg-sunken p-0.5"
      >
        {options.map((o, i) => (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={i === selected}
            tabIndex={i === selected ? 0 : -1}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={cx(
              'ds-target min-h-8 rounded-sm px-3 text-sm',
              i === selected ? 'bg-surface text-text shadow-sm' : 'text-text-2 hover:text-text',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
