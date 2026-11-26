// Pure keyboard and value logic shared by the design-system components (DESIGN §5, WAI-ARIA APG).
// Kept free of React and the DOM so it's unit-tested locally; components only wire it to events.

export type Orientation = 'horizontal' | 'vertical';

/**
 * Next index for roving focus / active option (APG: listbox, menu, tabs, radio group).
 * Returns null if the key isn't a navigation key. `disabled[i]` items are skipped.
 */
export function nextIndex(
  key: string,
  current: number,
  count: number,
  opts: { orientation?: Orientation; loop?: boolean; disabled?: readonly boolean[]; pageSize?: number } = {},
): number | null {
  if (count <= 0) return null;
  const { orientation = 'vertical', loop = true, disabled = [], pageSize = 10 } = opts;
  const enabled = (i: number) => !disabled[i];
  const anyEnabled = Array.from({ length: count }, (_, i) => i).some(enabled);
  if (!anyEnabled) return null;

  const first = () => {
    for (let i = 0; i < count; i += 1) if (enabled(i)) return i;
    return null;
  };
  const last = () => {
    for (let i = count - 1; i >= 0; i -= 1) if (enabled(i)) return i;
    return null;
  };
  const step = (dir: 1 | -1, from: number) => {
    let i = from;
    for (let n = 0; n < count; n += 1) {
      i += dir;
      if (i >= count) {
        if (!loop) return from;
        i = 0;
      } else if (i < 0) {
        if (!loop) return from;
        i = count - 1;
      }
      if (enabled(i)) return i;
    }
    return from;
  };

  const forward = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight';
  const backward = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft';
  const start = current < 0 || current >= count ? -1 : current;

  switch (key) {
    case forward:
      return start === -1 ? first() : step(1, start);
    case backward:
      return start === -1 ? last() : step(-1, start);
    case 'Home':
      return first();
    case 'End':
      return last();
    case 'PageDown': {
      let i = start === -1 ? 0 : start;
      for (let n = 0; n < pageSize; n += 1) {
        const next = step(1, i);
        if (next <= i) break;
        i = next;
      }
      return enabled(i) ? i : first();
    }
    case 'PageUp': {
      let i = start === -1 ? count - 1 : start;
      for (let n = 0; n < pageSize; n += 1) {
        const next = step(-1, i);
        if (next >= i) break;
        i = next;
      }
      return enabled(i) ? i : last();
    }
    default:
      return null;
  }
}

/**
 * Type-ahead (APG listbox/menu): typing letters jumps to the next label starting with the buffer,
 * searching from just after the current item and wrapping. Returns null if nothing matches.
 */
export function typeaheadIndex(
  buffer: string,
  labels: readonly string[],
  current: number,
  disabled: readonly boolean[] = [],
): number | null {
  const q = buffer.trim().toLocaleLowerCase();
  if (!q) return null;
  const n = labels.length;
  // Repeating one letter ("sss") cycles through items starting with that letter.
  const cycling = q.length > 1 && [...q].every((c) => c === q[0]);
  const needle = cycling ? q[0] ?? '' : q;
  const startAt = cycling || q.length === 1 ? current + 1 : current;
  for (let k = 0; k < n; k += 1) {
    const i = (((startAt + k) % n) + n) % n;
    if (disabled[i]) continue;
    if ((labels[i] ?? '').toLocaleLowerCase().startsWith(needle)) return i;
  }
  return null;
}

/** Slider value math (APG slider): clamp to [min, max] and snap to the step grid from `min`. */
export function snapValue(value: number, min: number, max: number, step: number): number {
  if (!(max > min)) return min;
  const clamped = Math.min(max, Math.max(min, value));
  if (!(step > 0)) return clamped;
  const steps = Math.round((clamped - min) / step);
  const snapped = min + steps * step;
  // Avoid float noise like 0.30000000000000004 by rounding to the step's precision.
  const decimals = Math.max(decimalPlaces(step), decimalPlaces(min));
  return Math.min(max, Number(snapped.toFixed(decimals)));
}

function decimalPlaces(n: number): number {
  const s = String(n);
  const i = s.indexOf('.');
  return i === -1 ? 0 : s.length - i - 1;
}

/** Keyboard → new slider value (APG): arrows ±step, PageUp/PageDown ±bigStep, Home/End min/max. */
export function sliderKeyValue(
  key: string,
  value: number,
  opts: { min: number; max: number; step: number; bigStep?: number },
): number | null {
  const { min, max, step } = opts;
  const big = opts.bigStep ?? Math.max(step, (max - min) / 10);
  switch (key) {
    case 'ArrowRight':
    case 'ArrowUp':
      return snapValue(value + step, min, max, step);
    case 'ArrowLeft':
    case 'ArrowDown':
      return snapValue(value - step, min, max, step);
    case 'PageUp':
      return snapValue(value + big, min, max, step);
    case 'PageDown':
      return snapValue(value - big, min, max, step);
    case 'Home':
      return min;
    case 'End':
      return max;
    default:
      return null;
  }
}

/** Pointer position along a track → value. `fraction` is 0 at the start of the track, 1 at the end. */
export function valueFromFraction(fraction: number, min: number, max: number, step: number): number {
  const f = Math.min(1, Math.max(0, fraction));
  return snapValue(min + f * (max - min), min, max, step);
}

/** Percentage of the track filled for a value, for drawing. */
export function fractionFromValue(value: number, min: number, max: number): number {
  if (!(max > min)) return 0;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}
