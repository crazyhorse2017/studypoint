// Slider (APG slider pattern; DESIGN §5). Used for daily minutes and the retention target.
// Keyboard: arrows ±step, PageUp/PageDown ±bigStep, Home/End. Pointer: click or drag the track.

import { useId, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { cx } from './cx.ts';
import { fractionFromValue, sliderKeyValue, valueFromFraction } from './keys.ts';

export type SliderProps = {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  bigStep?: number;
  /** Human-readable value, e.g. "20 minutes" or "90%". Also used as aria-valuetext. */
  format?: (value: number) => string;
  disabled?: boolean;
};

export function Slider({ label, value, onChange, min, max, step, bigStep, format = String, disabled = false }: SliderProps) {
  const id = useId();
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const fromPointer = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    onChange(valueFromFraction((clientX - rect.left) / rect.width, min, max, step));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const next = sliderKeyValue(e.key, value, { min, max, step, bigStep });
    if (next === null) return;
    e.preventDefault();
    if (next !== value) onChange(next);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    fromPointer(e.clientX);
  };

  const pct = `${fractionFromValue(value, min, max) * 100}%`;
  const text = format(value);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span id={`${id}-label`} className="text-text">
          {label}
        </span>
        <span aria-hidden="true" className="font-mono text-sm text-text-2">
          {text}
        </span>
      </div>
      <div
        ref={trackRef}
        className={cx('relative flex h-6 items-center', disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer')}
        onPointerDown={onPointerDown}
        onPointerMove={(e) => dragging.current && fromPointer(e.clientX)}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
      >
        <div aria-hidden="true" className="h-1.5 w-full rounded-full border border-border-strong bg-sunken">
          <div className="h-full rounded-full bg-accent" style={{ width: pct }} />
        </div>
        <div
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-labelledby={`${id}-label`}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          aria-valuetext={text}
          aria-disabled={disabled || undefined}
          onKeyDown={onKeyDown}
          className="ds-target absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent bg-surface"
          style={{ left: pct }}
        />
      </div>
    </div>
  );
}
