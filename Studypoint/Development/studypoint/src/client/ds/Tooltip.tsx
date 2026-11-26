// Tooltip (APG tooltip; DESIGN §5). Shows on hover AND keyboard focus, stays while the pointer is over
// it, and Escape dismisses it (WCAG 1.4.13 Content on Hover or Focus). Supplementary text only:
// never put essential information or interactive content in a tooltip.

import { cloneElement, isValidElement, useEffect, useId, useRef, useState, type ReactElement } from 'react';
import { cx } from './cx.ts';

export type TooltipProps = {
  content: string;
  /** A single focusable element (button, link). */
  children: ReactElement<Record<string, unknown>>;
  side?: 'top' | 'bottom';
  delayMs?: number;
};

export function Tooltip({ content, children, side = 'top', delayMs = 400 }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const showSoon = () => {
    clear();
    timer.current = setTimeout(() => setOpen(true), delayMs);
  };
  const showNow = () => {
    clear();
    setOpen(true);
  };
  const hide = () => {
    clear();
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => clear, []);

  if (!isValidElement(children)) return children;
  const existing = typeof children.props['aria-describedby'] === 'string' ? `${children.props['aria-describedby']} ` : '';
  const trigger = cloneElement(children, {
    'aria-describedby': `${existing}${id}`,
    onFocus: showNow,
    onBlur: hide,
  });

  return (
    <span className="relative inline-flex" onMouseEnter={showSoon} onMouseLeave={hide}>
      {trigger}
      <span
        id={id}
        role="tooltip"
        hidden={!open}
        className={cx(
          'absolute left-1/2 z-40 w-max max-w-64 -translate-x-1/2 rounded-sm border border-border bg-surface px-2 py-1 text-sm text-text shadow-pop',
          side === 'top' ? 'bottom-full mb-2' : 'top-full mt-2',
        )}
      >
        {content}
      </span>
    </span>
  );
}
