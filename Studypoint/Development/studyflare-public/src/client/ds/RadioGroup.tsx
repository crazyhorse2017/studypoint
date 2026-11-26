// RadioGroup (APG radio group; DESIGN §5). Vertical list with descriptions; roving tabindex,
// arrows move and select. Replaces native radio inputs (AGENTS 17).

import { useId, useRef, type KeyboardEvent } from 'react';
import { cx } from './cx.ts';
import { nextIndex } from './keys.ts';

export type RadioOption<T extends string> = { value: T; label: string; description?: string; disabled?: boolean };

export type RadioGroupProps<T extends string> = {
  label: string;
  value: T | null;
  options: readonly RadioOption<T>[];
  onChange: (value: T) => void;
};

export function RadioGroup<T extends string>({ label, value, options, onChange }: RadioGroupProps<T>) {
  const id = useId();
  const refs = useRef<Array<HTMLDivElement | null>>([]);
  const selected = options.findIndex((o) => o.value === value);
  const disabled = options.map((o) => !!o.disabled);
  // With nothing selected, the first enabled option is the Tab stop (APG).
  const tabStop = selected >= 0 ? selected : (nextIndex('Home', -1, options.length, { disabled }) ?? 0);

  const select = (i: number) => {
    const opt = options[i];
    if (!opt || opt.disabled) return;
    onChange(opt.value);
    refs.current[i]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === ' ') {
      e.preventDefault();
      const focused = refs.current.findIndex((el) => el === document.activeElement);
      if (focused >= 0) select(focused);
      return;
    }
    const v = nextIndex(e.key, tabStop, options.length, { orientation: 'vertical', disabled });
    const h = nextIndex(e.key, tabStop, options.length, { orientation: 'horizontal', disabled });
    const next = e.key === 'Home' || e.key === 'End' ? null : (v ?? h);
    if (next === null) return;
    e.preventDefault();
    select(next);
  };

  return (
    <div className="flex flex-col gap-2">
      <span id={`${id}-label`} className="text-text">
        {label}
      </span>
      <div role="radiogroup" aria-labelledby={`${id}-label`} onKeyDown={onKeyDown} className="flex flex-col gap-1">
        {options.map((o, i) => {
          const checked = i === selected;
          return (
            <div
              key={o.value}
              ref={(el) => {
                refs.current[i] = el;
              }}
              role="radio"
              aria-checked={checked}
              aria-disabled={o.disabled || undefined}
              aria-describedby={o.description ? `${id}-d${i}` : undefined}
              tabIndex={i === tabStop && !o.disabled ? 0 : -1}
              onClick={() => select(i)}
              className={cx(
                'ds-target flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-sunken',
                o.disabled && 'cursor-not-allowed opacity-50',
              )}
            >
              <span
                aria-hidden="true"
                className={cx(
                  'mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                  checked ? 'border-accent' : 'border-border-strong',
                )}
              >
                {checked ? <span className="h-2.5 w-2.5 rounded-full bg-accent" /> : null}
              </span>
              <span className="flex flex-col">
                <span className="text-text">{o.label}</span>
                {o.description ? (
                  <span id={`${id}-d${i}`} className="text-sm text-text-2">
                    {o.description}
                  </span>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
