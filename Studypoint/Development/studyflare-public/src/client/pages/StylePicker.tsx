// Style picker (DESIGN §2.8): a radio group of live previews. Each preview sets data-style/data-theme on
// its own wrapper, so the real tokens render it (the same sample answer and card as the mockups).

import { useRef, type KeyboardEvent } from 'react';
import { cx } from '../ds/cx.ts';
import { nextIndex } from '../ds/keys.ts';
import type { StyleName } from '../../shared/settings.ts';

const STYLE_INFO: ReadonlyArray<{ value: StyleName; label: string; blurb: string }> = [
  { value: 'paper', label: 'Paper', blurb: 'Warm and book-like, with serif reading text. The default.' },
  { value: 'lab', label: 'Lab notebook', blurb: 'Cool and precise, with monospace numbers.' },
  { value: 'midnight', label: 'Midnight focus', blurb: 'Dark-first and high contrast, with a soft violet accent.' },
];

export function StylePicker({ value, theme, onChange }: { value: StyleName; theme: 'light' | 'dark'; onChange: (s: StyleName) => void }) {
  const refs = useRef<Array<HTMLDivElement | null>>([]);
  const selected = Math.max(0, STYLE_INFO.findIndex((s) => s.value === value));

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = nextIndex(e.key, selected, STYLE_INFO.length, { orientation: 'horizontal' }) ?? nextIndex(e.key, selected, STYLE_INFO.length, { orientation: 'vertical' });
    if (next === null || e.key === 'Home' || e.key === 'End') return;
    e.preventDefault();
    const s = STYLE_INFO[next];
    if (s) {
      onChange(s.value);
      refs.current[next]?.focus();
    }
  };

  return (
    <div role="radiogroup" aria-labelledby="style-label" onKeyDown={onKeyDown} className="grid gap-3 sm:grid-cols-3">
      {STYLE_INFO.map((s, i) => (
        <div
          key={s.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          role="radio"
          aria-checked={i === selected}
          aria-describedby={`style-blurb-${s.value}`}
          tabIndex={i === selected ? 0 : -1}
          onClick={() => onChange(s.value)}
          className={cx(
            'flex cursor-pointer flex-col gap-2 rounded-lg border-2 p-2',
            i === selected ? 'border-accent' : 'border-border hover:border-border-strong',
          )}
        >
          {/* Live preview in that style's own tokens. */}
          <div data-style={s.value} data-theme={theme} aria-hidden="true" className="rounded-md bg-page p-3 text-text">
            <div className="rounded-md border border-border bg-surface p-2">
              <p className="reading text-sm leading-snug">
                The derivative measures a rate of change.
                <span className="ml-1 rounded-sm bg-accent-bg px-1 text-xs text-chip-text">Notes · p. 12</span>
              </p>
              <p className="mt-2 border-l-2 border-general-rule bg-general-bg px-2 py-1 text-xs text-general-text">General knowledge</p>
              <div className="mt-2 grid grid-cols-4 gap-1 text-center text-[11px]">
                <span className="rounded-sm bg-again-bg text-again-text">Again</span>
                <span className="rounded-sm bg-hard-bg text-hard-text">Hard</span>
                <span className="rounded-sm bg-good-bg text-good-text">Good</span>
                <span className="rounded-sm bg-easy-bg text-easy-text">Easy</span>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between px-1">
            <span className="font-semibold text-text">{s.label}</span>
            {i === selected ? <span className="text-xs text-accent">Selected</span> : null}
          </div>
          <p id={`style-blurb-${s.value}`} className="px-1 text-sm text-text-2">
            {s.blurb}
          </p>
        </div>
      ))}
    </div>
  );
}
