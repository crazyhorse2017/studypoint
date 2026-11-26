// Tabs (APG tabs, automatic activation; DESIGN §5). Arrow keys move between tabs and show their panel;
// Tab moves into the panel. Used for the reader/assistant split on tablets (DESIGN §3).

import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from './cx.ts';
import { nextIndex } from './keys.ts';

export type TabItem<T extends string> = { value: T; label: string; panel: ReactNode; disabled?: boolean };

export type TabsProps<T extends string> = {
  /** Accessible name for the tab list. */
  label: string;
  value: T;
  onChange: (value: T) => void;
  tabs: readonly TabItem<T>[];
};

export function Tabs<T extends string>({ label, value, onChange, tabs }: TabsProps<T>) {
  const id = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const selected = Math.max(0, tabs.findIndex((t) => t.value === value));

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = nextIndex(e.key, selected, tabs.length, { orientation: 'horizontal', disabled: tabs.map((t) => !!t.disabled) });
    if (next === null) return;
    e.preventDefault();
    const tab = tabs[next];
    if (tab) {
      onChange(tab.value);
      refs.current[next]?.focus();
    }
  };

  return (
    <div className="flex flex-col">
      <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className="flex gap-1 border-b border-border">
        {tabs.map((t, i) => (
          <button
            key={t.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${id}-tab-${i}`}
            aria-selected={i === selected}
            aria-controls={`${id}-panel-${i}`}
            tabIndex={i === selected ? 0 : -1}
            disabled={t.disabled}
            onClick={() => onChange(t.value)}
            className={cx(
              'ds-target -mb-px border-b-2 px-3 py-2 text-sm',
              i === selected ? 'border-accent font-semibold text-text' : 'border-transparent text-text-2 hover:text-text',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t, i) => (
        <div
          key={t.value}
          role="tabpanel"
          id={`${id}-panel-${i}`}
          aria-labelledby={`${id}-tab-${i}`}
          hidden={i !== selected}
          tabIndex={0}
          className="pt-4"
        >
          {i === selected ? t.panel : null}
        </div>
      ))}
    </div>
  );
}
